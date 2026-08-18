#!/usr/bin/env node
/**
 * queue-batch-input.mjs — bridge script for the cloud pipeline (#cloud-pipeline)
 *
 * batch/batch-runner.sh reads batch/batch-input.tsv (id, url, source, notes) —
 * per batch/README.md, that file is normally hand-curated. In the headless
 * GitHub Actions path (.github/workflows/cloud-pipeline.yml) nothing is
 * interactive, so this script fills batch-input.tsv deterministically from
 * two possible sources, selected by --source:
 *
 *   --source=pipeline   Parse `- [ ] {url} | ...` rows out of the "Pending"
 *                        section of data/pipeline.md (the format scan.mjs /
 *                        scan-ats-full.mjs / roster.mjs already write — see
 *                        modes/pipeline.md "Format of pipeline.md").
 *   --source=json        Parse a JSON array from --json='[...]' or from the
 *                        JOB_URLS_JSON env var — each element either a plain
 *                        URL string or an {url, source, notes} object (the
 *                        shape an external caller like a Google Apps Script
 *                        dispatcher sends as repository_dispatch client_payload
 *                        .job_urls, or workflow_dispatch's job_urls_json input).
 *
 * Zero-LLM, zero-network. Appends rows (never overwrites existing ones —
 * batch-runner.sh / batch-state.tsv already handle resumability and dedup
 * downstream), continuing numbering after whatever the highest existing `id`
 * in batch-input.tsv already is, exactly like reserve-report-num.mjs does for
 * report numbers (never trust a caller to hand you the next id).
 *
 * Usage:
 *   node queue-batch-input.mjs --source=pipeline
 *   node queue-batch-input.mjs --source=json --json='["https://...", {"url":"https://...","source":"Himalayas","notes":"AI Engineer"}]'
 *   JOB_URLS_JSON='[...]' node queue-batch-input.mjs --source=json
 *   node queue-batch-input.mjs --self-test
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const PIPELINE_PATH = 'data/pipeline.md';
const BATCH_INPUT_PATH = 'batch/batch-input.tsv';

function flagValue(args, name) {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

// Mirrors the row grammar documented in modes/pipeline.md "Format of pipeline.md":
// `- [ ] {url}` then 0-4 optional ` | {cell}` columns/labeled segments. We only
// need url + company (for notes) here — location/comp/posted/trust/note/rank
// segments are for human triage and are folded into `notes` verbatim so nothing
// is silently dropped, but they're not parsed field-by-field.
export function parsePendingUrls(pipelineMd) {
  const pendingSection = pipelineMd.split(/^##\s+Processed\s*$/m)[0];
  const lines = pendingSection.split('\n').filter((l) => l.trim().startsWith('- [ ]'));
  return lines.map((line) => {
    const body = line.replace(/^-\s*\[\s*\]\s*/, '').trim();
    const cells = body.split('|').map((c) => c.trim());
    const url = cells[0];
    const company = cells[1] || '';
    const rest = cells.slice(2).join(' | ');
    const notes = [company, rest].filter(Boolean).join(' — ');
    return { url, source: 'pipeline.md', notes };
  }).filter((row) => /^https?:\/\//.test(row.url) || row.url.startsWith('local:'));
}

// External callers (Apps Script, workflow_dispatch input) send either plain
// URL strings or {url, source, notes} objects — accept both so the caller
// doesn't have to pre-shape data just to satisfy this script.
export function parseJsonUrls(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => {
    if (typeof entry === 'string') return { url: entry, source: 'external', notes: '' };
    if (entry && typeof entry === 'object' && typeof entry.url === 'string') {
      return { url: entry.url, source: entry.source || 'external', notes: entry.notes || '' };
    }
    return null;
  }).filter((row) => row && /^https?:\/\//.test(row.url));
}

function nextId(existingTsv) {
  if (!existingTsv.trim()) return 1;
  const rows = existingTsv.trim().split('\n').slice(1); // skip header
  const ids = rows.map((r) => parseInt(r.split('\t')[0], 10)).filter((n) => Number.isFinite(n));
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function tsvEscape(s) {
  return String(s || '').replace(/[\t\n\r]/g, ' ').trim();
}

export function buildRows(entries, startId) {
  return entries.map((e, i) => [startId + i, e.url, tsvEscape(e.source), tsvEscape(e.notes)].join('\t'));
}

function main() {
  const args = process.argv.slice(2);
  const source = flagValue(args, 'source');

  let entries = [];
  if (source === 'pipeline') {
    if (!existsSync(PIPELINE_PATH)) {
      console.log(`${PIPELINE_PATH} not found — nothing to queue.`);
      return;
    }
    entries = parsePendingUrls(readFileSync(PIPELINE_PATH, 'utf-8'));
  } else if (source === 'json') {
    const jsonText = flagValue(args, 'json') ?? process.env.JOB_URLS_JSON ?? '[]';
    entries = parseJsonUrls(jsonText);
  } else {
    console.error('Usage: node queue-batch-input.mjs --source=pipeline|json [--json=\'[...]\']');
    process.exit(1);
  }

  if (entries.length === 0) {
    console.log('No URLs to queue.');
    return;
  }

  const existing = existsSync(BATCH_INPUT_PATH) ? readFileSync(BATCH_INPUT_PATH, 'utf-8') : '';
  const header = 'id\turl\tsource\tnotes';
  const startId = nextId(existing);
  const newRows = buildRows(entries, startId);

  const out = existing.trim()
    ? existing.trimEnd() + '\n' + newRows.join('\n') + '\n'
    : header + '\n' + newRows.join('\n') + '\n';

  writeFileSync(BATCH_INPUT_PATH, out, 'utf-8');
  console.log(`Queued ${newRows.length} URL(s) into ${BATCH_INPUT_PATH} (ids ${startId}-${startId + newRows.length - 1}).`);
}

function runSelfTest() {
  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.error(`FAIL: ${name}`); } };

  const md = `# Pipeline\n\n## Pending\n- [ ] https://a.example/1 | Acme | AI Engineer | Remote\n- [ ] https://b.example/2\n\n## Processed\n- [x] #1 | https://old.example/9 | Old | Role | 4.0/5 | PDF ✅\n`;
  const parsed = parsePendingUrls(md);
  check('parses 2 pending, ignores Processed section', parsed.length === 2);
  check('keeps company in notes', parsed[0].notes.includes('Acme'));
  check('bare-url row has empty-ish notes', parsed[1].url === 'https://b.example/2');

  const jsonEntries = parseJsonUrls('["https://plain.example", {"url":"https://obj.example","source":"Himalayas","notes":"n"}, {"bad":"row"}]');
  check('parses mixed string/object JSON, drops malformed', jsonEntries.length === 2);
  check('object form keeps source', jsonEntries[1].source === 'Himalayas');

  check('nextId on empty tsv starts at 1', nextId('') === 1);
  check('nextId continues after existing max', nextId('id\turl\tsource\tnotes\n5\thttp://x\ta\tb\n7\thttp://y\ta\tb\n') === 8);

  const rows = buildRows([{ url: 'https://x', source: 's', notes: 'n' }], 3);
  check('buildRows formats tab-separated row with given id', rows[0] === '3\thttps://x\ts\tn');

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    main();
  }
}
