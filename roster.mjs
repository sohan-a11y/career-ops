#!/usr/bin/env node
/**
 * roster.mjs — Excel company-roster → ATS discovery → scan, for career-ops
 *
 * Takes a spreadsheet of {company name, career page URL} rows — one company
 * per row, however many the user has collected — and turns it into scannable
 * portals.yml entries, then (optionally) triggers a scoped scan for each
 * newly-added company. This is the ingestion+discovery front door for the
 * `/career-ops roster` mode: it does the mechanical, zero-LLM part (parse the
 * sheet, resolve ATS boards, write portals.yml, pull matching postings into
 * data/pipeline.md); the AI-driven evaluation/tailoring/tracking after that
 * is `modes/pipeline.md`'s existing job (run `/career-ops pipeline` next, or
 * let this script's caller hand off to it automatically).
 *
 * Two URL shapes are handled differently:
 *   1. The sheet already points at a KNOWN ATS URL (job-boards.greenhouse.io,
 *      jobs.ashbyhq.com, jobs.lever.co, *.myworkdayjobs.com) — no probing
 *      needed, the entry is built directly from the URL you already have.
 *   2. The sheet points at a branded company careers page (e.g.
 *      acme.com/careers) — delegates to discover-ats.mjs's existing
 *      probe-and-resolve logic (Greenhouse/Ashby/Lever slug guessing +
 *      Workday coordinate resolution) to find the underlying board.
 *
 * portals.yml is a USER-LAYER file: by default this is preview-only. Pass
 * --write to actually append resolved entries (same opt-in contract as
 * discover-ats.mjs).
 *
 * Every phase transition is written to data/roster-telemetry.json (a
 * RosterSnapshot — see dashboard/internal/synthesis/provider.go for the Go
 * mirror of this shape) so `npm run roster:watch` can tail live progress in
 * a terminal dashboard while a big roster runs.
 *
 * Run: node roster.mjs data/company-roster.xlsx                (preview)
 *      node roster.mjs data/company-roster.xlsx --write         (opt-in write)
 *      node roster.mjs data/company-roster.xlsx --write --scan  (write + scoped scan)
 *      node roster.mjs data/company-roster.xlsx --summary
 *      node roster.mjs --self-test
 */

import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname, join, resolve, extname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import ExcelJS from 'exceljs';

import {
  parseCompanyInput,
  runDiscovery,
  dedupeAgainstPortals,
  renderPortalEntry,
  insertIntoTrackedCompanies,
  deriveSlug,
} from './discover-ats.mjs';
import { makeHttpCtx } from './providers/_http.mjs';
import * as yaml from 'js-yaml';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || join(CAREER_OPS, 'portals.yml');
const TELEMETRY_PATH = process.env.CAREER_OPS_ROSTER_TELEMETRY || join(CAREER_OPS, 'data', 'roster-telemetry.json');

const USAGE = `Usage:
  node roster.mjs <roster.xlsx>                 # PREVIEW — resolve + print, write nothing
  node roster.mjs <roster.xlsx> --write         # opt in: append resolved entries to portals.yml
  node roster.mjs <roster.xlsx> --write --scan  # write, then run a scoped scan per new company
  node roster.mjs <roster.xlsx> --summary       # human-readable table
  node roster.mjs <roster.xlsx> --sheet "Sheet2"  # pick a non-default sheet
  node roster.mjs --self-test                   # inline test suite (no file, no network)
  node roster.mjs --help                        # print this usage block

portals.yml is a user-layer file: this command NEVER writes it unless you pass
--write. The default previews the entries it would add.

Expected spreadsheet shape: one row per company, any column order. Header
names are matched case-insensitively — a "company"/"name"/"employer" column
for the name, and a "career page"/"careers url"/"url"/"link" column for the
URL. Falls back to the first two non-empty columns when no header matches.

Every phase is mirrored to data/roster-telemetry.json for the live TUI
(\`npm run roster:watch\`).
`;

// Known ATS host patterns — a sheet row pointing directly at one of these
// already IS the resolvable board; skip discover-ats.mjs's probing entirely
// and build the portals.yml entry straight from the URL you already have.
const DIRECT_ATS_PATTERNS = [
  {
    vendor: 'greenhouse',
    re: /^https?:\/\/job-boards\.greenhouse\.io\/([A-Za-z0-9._-]+)/i,
    build: (m, name) => ({
      name,
      vendor: 'greenhouse',
      careers_url: `https://job-boards.greenhouse.io/${m[1]}`,
      api: `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs`,
    }),
  },
  {
    vendor: 'ashby',
    re: /^https?:\/\/jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/i,
    build: (m, name) => ({
      name,
      vendor: 'ashby',
      careers_url: `https://jobs.ashbyhq.com/${m[1]}`,
    }),
  },
  {
    vendor: 'lever',
    re: /^https?:\/\/jobs\.lever\.co\/([A-Za-z0-9._-]+)/i,
    build: (m, name) => ({
      name,
      vendor: 'lever',
      careers_url: `https://jobs.lever.co/${m[1]}`,
    }),
  },
  {
    vendor: 'workday',
    re: /^https?:\/\/([A-Za-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[A-Za-z0-9_-]+\/)?([A-Za-z0-9_-]+)/i,
    build: (m, name) => ({
      name,
      vendor: 'workday',
      careers_url: `https://${m[1]}.${m[2]}.myworkdayjobs.com/${m[3]}`,
      provider: 'workday',
    }),
  },
];

// ── Spreadsheet parsing (pure, exported for tests) ──────────────────────

const NAME_HEADER_HINTS = ['company', 'name', 'employer', 'company name'];
const URL_HEADER_HINTS = ['career page', 'careers url', 'careers_url', 'career url', 'url', 'link', 'careers', 'website', 'career page url'];

/**
 * Find the best-matching column index for a set of header hints.
 * Case-insensitive exact match first, then substring match.
 * @param {string[]} headerRow
 * @param {string[]} hints
 * @returns {number} column index, or -1 if none matched
 */
export function findColumn(headerRow, hints) {
  const lower = headerRow.map((h) => String(h ?? '').trim().toLowerCase());
  for (const hint of hints) {
    const idx = lower.indexOf(hint);
    if (idx !== -1) return idx;
  }
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.includes(hint));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse a roster of {name, careers_url} rows out of a 2D array of cells
 * (one array per row, one string per cell — see readRosterFile). Never
 * throws on malformed/empty sheets — returns warnings instead, mirroring
 * discover-ats.mjs's parseCompanyInput contract.
 *
 * @param {unknown[][]} rows
 * @returns {{ companies: {name: string, careers_url: string}[], warnings: string[] }}
 */
export function parseRosterRows(rows) {
  const warnings = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { companies: [], warnings: ['Spreadsheet is empty.'] };
  }

  const header = rows[0].map((c) => String(c ?? ''));
  let nameCol = findColumn(header, NAME_HEADER_HINTS);
  let urlCol = findColumn(header, URL_HEADER_HINTS);
  let dataRows = rows.slice(1);

  // No recognizable header at all → treat row 0 as data, assume columns
  // {0: name, 1: url} (the natural order for a two-column roster).
  const headerLooksBlank = header.every((c) => !String(c).trim());
  if ((nameCol === -1 || urlCol === -1) && headerLooksBlank) {
    nameCol = 0;
    urlCol = 1;
    dataRows = rows;
  } else if (nameCol === -1 || urlCol === -1) {
    // Header exists but didn't match known hints — fall back to first two
    // columns rather than dropping every row.
    warnings.push('No "company"/"career page" style headers recognized — falling back to the first two columns.');
    nameCol = nameCol === -1 ? 0 : nameCol;
    urlCol = urlCol === -1 ? 1 : urlCol;
  }

  const seen = new Set();
  const companies = [];
  dataRows.forEach((row, i) => {
    const name = String(row?.[nameCol] ?? '').trim();
    const url = String(row?.[urlCol] ?? '').trim();
    const lineNo = i + 2; // +1 for header, +1 for 1-indexing
    if (!name && !url) return; // silently skip fully blank rows
    if (!name) { warnings.push(`Row ${lineNo}: missing company name — skipped.`); return; }
    if (!url) { warnings.push(`Row ${lineNo} (${name}): missing career page URL — skipped.`); return; }
    if (!/^https?:\/\//i.test(url)) { warnings.push(`Row ${lineNo} (${name}): "${url}" doesn't look like a URL — skipped.`); return; }
    const key = name.toLowerCase();
    if (seen.has(key)) { warnings.push(`Row ${lineNo}: duplicate company "${name}" — kept first occurrence.`); return; }
    seen.add(key);
    companies.push({ name, careers_url: url });
  });

  return { companies, warnings };
}

/**
 * Read an .xlsx/.xlsm/.csv file and return its roster rows.
 * (Legacy binary .xls is not supported — exceljs reads OOXML + CSV only.)
 * @param {string} filePath
 * @param {string} [sheetName] explicit sheet name; defaults to the first sheet
 */
export async function readRosterFile(filePath, sheetName) {
  const workbook = new ExcelJS.Workbook();
  const isCsv = extname(filePath).toLowerCase() === '.csv';

  let worksheet;
  if (isCsv) {
    worksheet = await workbook.csv.readFile(filePath);
  } else {
    await workbook.xlsx.readFile(filePath);
    worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
    if (!worksheet) {
      const available = workbook.worksheets.map((ws) => ws.name).join(', ');
      throw new Error(`Sheet "${sheetName}" not found. Available: ${available}`);
    }
  }

  // eachRow is 1-indexed and skips genuinely absent rows (not blank ones) —
  // walk explicitly by rowCount so a blank row in the middle of the sheet
  // still produces an (empty) row for parseRosterRows to skip with a warning
  // rather than silently shifting every row after it up by one.
  const rows = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cells = [];
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const cell = row.getCell(c);
      cells.push(cell.text ?? cell.value ?? '');
    }
    rows.push(cells);
  }

  return parseRosterRows(rows);
}

// ── Direct ATS URL classification (pure, exported for tests) ───────────

/**
 * Classify a roster company's URL: does it already point directly at a known
 * ATS board (no probing needed), or is it a branded page that needs
 * discover-ats.mjs's resolution?
 * @param {{name: string, careers_url: string}} company
 * @returns {{ direct: object } | { needsDiscovery: true }}
 */
export function classifyRosterEntry(company) {
  for (const pattern of DIRECT_ATS_PATTERNS) {
    const m = company.careers_url.match(pattern.re);
    if (m) return { direct: pattern.build(m, company.name) };
  }
  return { needsDiscovery: true };
}

// ── Telemetry (RosterSnapshot — mirrored in Go's internal/synthesis) ───

/**
 * @typedef {{name: string, status: string, vendor?: string, jobsFound?: number, error?: string}} CompanyProgress
 */

function makeSnapshot(phase, companies, extra = {}) {
  const now = new Date().toISOString();
  return {
    phase,
    totalCompanies: companies.length,
    companies,
    startedAt: extra.startedAt || now,
    updatedAt: now,
    done: phase === 'done',
    ...extra,
  };
}

function writeTelemetry(snapshot) {
  try {
    mkdirSync(dirname(TELEMETRY_PATH), { recursive: true });
    const tmp = `${TELEMETRY_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    renameSync(tmp, TELEMETRY_PATH); // atomic on same filesystem
  } catch (err) {
    // Telemetry is best-effort — never let a write failure break the run.
    console.error(`  (telemetry write skipped: ${err.message})`);
  }
}

// ── Scoped scan trigger ─────────────────────────────────────────────────

/**
 * Run `node scan.mjs --company "<name>"` for one newly-added company.
 * Returns the child process result; never throws (scan failures surface as
 * a non-zero status in the returned object, handled by the caller).
 */
export function scanCompany(name) {
  return spawnSync(process.execPath, [join(CAREER_OPS, 'scan.mjs'), '--company', name], {
    cwd: CAREER_OPS,
    encoding: 'utf-8',
    timeout: 120_000,
  });
}

// ── Self-test (pure, no network, no file I/O) ───────────────────────────

function runSelfTest() {
  let pass = 0, fail = 0;
  const check = (cond, label) => { if (cond) pass++; else { fail++; console.error(`  FAIL: ${label}`); } };

  // findColumn
  check(findColumn(['Company', 'Career Page'], NAME_HEADER_HINTS) === 0, 'findColumn exact match "Company"');
  check(findColumn(['Company', 'Career Page'], URL_HEADER_HINTS) === 1, 'findColumn exact match "Career Page"');
  check(findColumn(['Employer Name', 'Link'], NAME_HEADER_HINTS) === 0, 'findColumn substring match "Employer Name"');
  check(findColumn(['Foo', 'Bar'], NAME_HEADER_HINTS) === -1, 'findColumn no match returns -1');

  // parseRosterRows — normal header
  const r1 = parseRosterRows([
    ['Company', 'Career Page'],
    ['Adyen', 'https://job-boards.greenhouse.io/adyen'],
    ['Monzo', 'https://jobs.lever.co/monzo'],
  ]);
  check(r1.companies.length === 2, 'parseRosterRows reads two data rows');
  check(r1.companies[0].name === 'Adyen' && r1.companies[0].careers_url.includes('greenhouse'), 'parseRosterRows maps columns correctly');
  check(r1.warnings.length === 0, 'parseRosterRows no warnings on clean input');

  // parseRosterRows — headerless (blank header row) → positional fallback
  const r2 = parseRosterRows([
    ['', ''],
    ['Acme', 'https://acme.com/careers'],
  ]);
  check(r2.companies.length === 1 && r2.companies[0].name === 'Acme', 'parseRosterRows falls back positionally on blank header');

  // parseRosterRows — missing URL, bad URL, duplicate, blank row
  const r3 = parseRosterRows([
    ['Company', 'URL'],
    ['NoUrl', ''],
    ['BadUrl', 'not-a-url'],
    ['Good', 'https://good.com/careers'],
    ['Good', 'https://good.com/careers'],
    ['', ''],
  ]);
  check(r3.companies.length === 1 && r3.companies[0].name === 'Good', 'parseRosterRows skips missing/bad/dup/blank rows');
  check(r3.warnings.length === 3, 'parseRosterRows records one warning per skipped row (dup + missing + bad-url)');

  // parseRosterRows — empty sheet
  const r4 = parseRosterRows([]);
  check(r4.companies.length === 0 && r4.warnings.length === 1, 'parseRosterRows handles empty sheet');

  // classifyRosterEntry — direct ATS URLs
  const c1 = classifyRosterEntry({ name: 'Adyen', careers_url: 'https://job-boards.greenhouse.io/adyen' });
  check(c1.direct?.vendor === 'greenhouse' && c1.direct.api.includes('adyen'), 'classifyRosterEntry direct greenhouse');
  const c2 = classifyRosterEntry({ name: 'Monzo', careers_url: 'https://jobs.lever.co/monzo' });
  check(c2.direct?.vendor === 'lever', 'classifyRosterEntry direct lever');
  const c3 = classifyRosterEntry({ name: 'X', careers_url: 'https://jobs.ashbyhq.com/x' });
  check(c3.direct?.vendor === 'ashby', 'classifyRosterEntry direct ashby');
  const c4 = classifyRosterEntry({ name: 'Nvidia', careers_url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite' });
  check(c4.direct?.vendor === 'workday' && c4.direct.careers_url.includes('wd5'), 'classifyRosterEntry direct workday');
  const c5 = classifyRosterEntry({ name: 'Acme', careers_url: 'https://acme.com/careers' });
  check(c5.needsDiscovery === true, 'classifyRosterEntry branded page needs discovery');

  // makeSnapshot shape
  const snap = makeSnapshot('discover', [{ name: 'Adyen', status: 'resolved' }]);
  check(snap.phase === 'discover' && snap.totalCompanies === 1 && snap.done === false, 'makeSnapshot basic shape');
  const doneSnap = makeSnapshot('done', []);
  check(doneSnap.done === true, 'makeSnapshot done=true only in "done" phase');

  console.log(`\n  roster self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── CLI arg parsing ──────────────────────────────────────────────────

const KNOWN_FLAGS = ['--write', '--scan', '--summary', '--sheet', '--self-test', '--help', '-h'];
const VALUE_FLAGS = ['--sheet'];

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
  if (args.includes('--self-test')) { runSelfTest(); }

  const consumedValueIndices = new Set();
  args.forEach((a, idx) => {
    if (VALUE_FLAGS.includes(a) && args[idx + 1] !== undefined && !args[idx + 1].startsWith('--')) {
      consumedValueIndices.add(idx + 1);
    }
  });

  const unknownFlags = args.filter((a, idx) =>
    a.startsWith('-') && !consumedValueIndices.has(idx) && !KNOWN_FLAGS.includes(a.split('=')[0]));
  if (unknownFlags.length) {
    console.error(`Error: unrecognized flag(s): ${unknownFlags.join(', ')}. Valid flags: ${KNOWN_FLAGS.join(', ')}`);
    process.exit(1);
  }

  const valueOf = (flag) => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
    const kv = args.find((a) => a.startsWith(flag + '='));
    return kv ? kv.split('=').slice(1).join('=') : null;
  };

  const positional = args.filter((a, idx) => !a.startsWith('-') && !consumedValueIndices.has(idx));

  return {
    filePath: positional[0] || null,
    sheet: valueOf('--sheet'),
    write: args.includes('--write'),
    scan: args.includes('--scan'),
    summary: args.includes('--summary'),
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.filePath) {
    console.error('Error: no roster file given.\n');
    console.log(USAGE);
    process.exit(1);
  }

  const filePath = resolve(opts.filePath);
  if (!existsSync(filePath)) {
    console.error(`Error: file not found: ${filePath}`);
    process.exit(1);
  }
  if (!['.xlsx', '.xlsm', '.csv'].includes(extname(filePath).toLowerCase())) {
    console.error(`Error: unsupported file type "${extname(filePath)}". Expected .xlsx, .xlsm, or .csv (legacy binary .xls is not supported — re-save it as .xlsx first).`);
    process.exit(1);
  }

  // ── Phase 1: Ingest ────────────────────────────────────────────────
  const startedAt = new Date().toISOString();
  const { companies, warnings } = await readRosterFile(filePath, opts.sheet);

  if (warnings.length) {
    console.log(`⚠️  ${warnings.length} row warning(s):`);
    warnings.forEach((w) => console.log(`   - ${w}`));
    console.log('');
  }

  if (companies.length === 0) {
    console.log('No usable company rows found. Nothing to do.');
    writeTelemetry(makeSnapshot('done', [], { startedAt }));
    return;
  }

  console.log(`📋 Ingested ${companies.length} companies from ${filePath}\n`);

  let progress = companies.map((c) => ({ name: c.name, status: 'pending' }));
  writeTelemetry(makeSnapshot('ingest', progress, { startedAt }));

  // ── Phase 2: Classify + Discover ────────────────────────────────────
  const direct = [];
  const needsDiscovery = [];
  for (const company of companies) {
    const result = classifyRosterEntry(company);
    if (result.direct) direct.push(result.direct);
    else needsDiscovery.push({ name: company.name, website: company.careers_url });
  }

  console.log(`   ${direct.length} already point at a known ATS board (no probing needed)`);
  console.log(`   ${needsDiscovery.length} need resolution from a branded careers page\n`);

  progress = companies.map((c) => ({
    name: c.name,
    status: direct.find((d) => d.name === c.name) ? 'resolved' : 'resolving',
    vendor: direct.find((d) => d.name === c.name)?.vendor,
  }));
  writeTelemetry(makeSnapshot('discover', progress, { startedAt }));

  let discoveredResolved = [...direct];
  let discoveredUnresolved = [];

  if (needsDiscovery.length > 0) {
    const ctx = makeHttpCtx();
    const { resolved, unresolved } = await runDiscovery(needsDiscovery, { ctx });
    discoveredResolved = [...discoveredResolved, ...resolved];
    discoveredUnresolved = unresolved;
  }

  progress = companies.map((c) => {
    const r = discoveredResolved.find((d) => d.name === c.name);
    if (r) return { name: c.name, status: 'resolved', vendor: r.vendor, jobsFound: r.jobCount };
    const u = discoveredUnresolved.find((d) => d.name === c.name);
    if (u) return { name: c.name, status: 'unresolved', error: u.reason };
    return { name: c.name, status: 'unresolved', error: 'not processed' };
  });
  writeTelemetry(makeSnapshot('discover', progress, { startedAt }));

  // ── Dedupe against existing portals.yml, then preview or write ─────
  let existingEntries = [];
  if (existsSync(PORTALS_PATH)) {
    try {
      const parsed = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
      existingEntries = Array.isArray(parsed?.tracked_companies) ? parsed.tracked_companies : [];
    } catch { /* malformed portals.yml — treat as no existing entries */ }
  }

  const { fresh, duplicates } = dedupeAgainstPortals(discoveredResolved, existingEntries);

  console.log(`${'='.repeat(72)}`);
  console.log(`  Roster Discovery Summary`);
  console.log(`  resolved: ${discoveredResolved.length} | already in portals.yml: ${duplicates.length} | new: ${fresh.length} | unresolved: ${discoveredUnresolved.length}`);
  console.log(`${'='.repeat(72)}\n`);

  if (opts.summary || fresh.length) {
    console.log('  Company'.padEnd(26) + 'Vendor'.padEnd(14) + 'Jobs'.padEnd(7) + 'Board');
    console.log('  ' + '-'.repeat(88));
    for (const r of fresh) {
      console.log('  ' + String(r.name).substring(0, 22).padEnd(24) + String(r.vendor).padEnd(14) + String(r.jobCount ?? '-').padEnd(7) + r.careers_url);
    }
    console.log('');
  }

  if (discoveredUnresolved.length) {
    console.log('  Unresolved (manual follow-up needed):');
    for (const u of discoveredUnresolved) console.log(`    - ${u.name}: ${u.reason}`);
    console.log('');
  }

  if (!opts.write) {
    console.log(`  Preview only — nothing written. Re-run with --write to append ${fresh.length} new entries to portals.yml.`);
    writeTelemetry(makeSnapshot('done', progress, { startedAt }));
    return;
  }

  if (fresh.length === 0) {
    console.log('  Nothing new to write — all resolved companies are already tracked.');
  } else {
    const fileText = existsSync(PORTALS_PATH) ? readFileSync(PORTALS_PATH, 'utf-8') : 'tracked_companies:\n';
    const snippets = fresh.map(renderPortalEntry);
    const updated = insertIntoTrackedCompanies(fileText, snippets);
    const tmp = `${PORTALS_PATH}.tmp`;
    writeFileSync(tmp, updated);
    renameSync(tmp, PORTALS_PATH);
    console.log(`  ✅ Wrote ${fresh.length} new companies to ${PORTALS_PATH}`);
  }

  // ── Phase 3: Scoped scan (optional) ─────────────────────────────────
  if (opts.scan && fresh.length > 0) {
    console.log(`\n  Running a scoped scan for ${fresh.length} new companies...\n`);
    progress = progress.map((p) => (fresh.find((f) => f.name === p.name) ? { ...p, status: 'scanning' } : p));
    writeTelemetry(makeSnapshot('scan', progress, { startedAt }));

    for (const r of fresh) {
      const result = scanCompany(r.name);
      const ok = result.status === 0;
      console.log(`    ${ok ? '✅' : '⚠️'} ${r.name}${ok ? '' : ` (scan exited ${result.status})`}`);
      progress = progress.map((p) => (p.name === r.name ? { ...p, status: ok ? 'scanned' : 'error', error: ok ? undefined : String(result.stderr || '').slice(0, 200) } : p));
      writeTelemetry(makeSnapshot('scan', progress, { startedAt }));
    }
    console.log(`\n  Scan complete. New matching postings (if any) are in data/pipeline.md.`);
  }

  writeTelemetry(makeSnapshot('done', progress, { startedAt }));

  console.log(`\n  Next step: run /career-ops pipeline to evaluate + tailor CVs + track every`);
  console.log(`  posting that landed in data/pipeline.md — the full auto-pipeline, per JD.`);
  if (!opts.scan) {
    console.log(`  (No scan ran yet — re-run with --scan, or run /career-ops scan directly.)`);
  }
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`roster: ${err?.stack || err?.message || err}`);
    process.exit(1);
  });
}
