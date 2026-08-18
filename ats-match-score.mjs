#!/usr/bin/env node
/**
 * ats-match-score.mjs — turns jd-skill-gap.mjs's three-bucket classification
 * into the single percentage a real ATS keyword filter (Workday recruiting,
 * Taleo, iCIMS parsers) gates applicants on, for one already-evaluated report.
 *
 * Composition, not reimplementation — every piece here is an existing
 * career-ops script called the way its own CLI contract already documents:
 *
 *   1. batch/batch-state.tsv           → report_num -> url (batch-runner.sh
 *                                         already records this per row)
 *   2. browser-extract.mjs <url>       → { url, title, text } JD text
 *                                         (Playwright, read-only, zero LLM)
 *   3. jd-skill-gap.mjs <jd-text-file> → { existing, supportedByResume, gap }
 *                                         against the real cv.md (regex, zero LLM)
 *
 * matchPct = (existing + supportedByResume) / (existing + supportedByResume + gap) * 100
 * — "found somewhere in what you'd submit" over "everything the JD asked for."
 * `existing` (already in the Skills section) and `supportedByResume` (mentioned
 * in resume prose) both count as a match because both are things a real ATS
 * keyword scan would find in the submitted document; only `gap` (found nowhere)
 * counts against the score. Zero JD skills extracted -> null, not 0 or 100 —
 * an ATS score computed from nothing is not a score, it's a diagnostic; see
 * jd-skill-gap.mjs's own `lowConfidence` handling.
 *
 * Output: reports/{report_num}-ats-match.json (a permanent artifact next to the
 * report, not just an Action-log line) plus a human-readable summary on stdout.
 *
 * Usage:
 *   node ats-match-score.mjs reports/042-acme-2026-08-18.md
 *   node ats-match-score.mjs --self-test
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';

const STATE_FILE = 'batch/batch-state.tsv';

/** reports/{NNN}-{slug}-{date}.md -> NNN (integer), or null if the filename
 *  doesn't start with the standard zero-padded report-number prefix. */
export function reportNumFromFilename(filePath) {
  const m = /^(\d+)-/.exec(basename(filePath));
  return m ? parseInt(m[1], 10) : null;
}

/** Parse batch-state.tsv's `id url status started completed report_num score
 *  error retries` rows into a report_num -> url map. Rows with no report_num
 *  (failed before a number was claimed) are skipped — nothing to look up. */
export function urlForReportNum(stateTsv, reportNum) {
  const lines = stateTsv.trim().split('\n').slice(1); // skip header
  for (const line of lines) {
    const cols = line.split('\t');
    const [, url, , , , rn] = cols;
    if (rn && parseInt(rn, 10) === reportNum) return url;
  }
  return null;
}

/** existing/supportedByResume count as "found" (an ATS keyword scan sees
 *  anything in the submitted document); gap counts against. null when the
 *  JD yielded zero classified skills — nothing to divide by, and a computed
 *  0/0 would misreport as "0% match" rather than "couldn't extract". */
export function computeMatchPct(result) {
  const found = (result.existing?.length || 0) + (result.supportedByResume?.length || 0);
  const gap = result.gap?.length || 0;
  const total = found + gap;
  if (total === 0) return null;
  return Math.round((found / total) * 1000) / 10; // one decimal
}

function runNode(scriptArgs) {
  return execFileSync(process.execPath, scriptArgs, { encoding: 'utf-8' });
}

function main() {
  const reportPath = process.argv[2];
  if (!reportPath || !existsSync(reportPath)) {
    console.error('Usage: node ats-match-score.mjs <report-file>');
    process.exit(1);
  }

  const reportNum = reportNumFromFilename(reportPath);
  if (reportNum === null) {
    console.error(`Could not parse a report number from ${reportPath} — expected reports/{NNN}-....md`);
    process.exit(1);
  }

  if (!existsSync(STATE_FILE)) {
    console.error(`${STATE_FILE} not found — this script only works after a batch-runner.sh run.`);
    process.exit(1);
  }
  const url = urlForReportNum(readFileSync(STATE_FILE, 'utf-8'), reportNum);
  if (!url) {
    console.error(`No URL found for report #${reportNum} in ${STATE_FILE}.`);
    process.exit(1);
  }

  let jdText;
  try {
    const extracted = JSON.parse(runNode(['browser-extract.mjs', url, '--mode', 'jd']));
    jdText = extracted.text || '';
  } catch (err) {
    console.error(`browser-extract.mjs failed for ${url}: ${err.message}`);
    process.exit(1);
  }
  if (!jdText.trim()) {
    console.error(`Empty JD text extracted for report #${reportNum} — skipping ATS score.`);
    process.exit(1);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'ats-match-'));
  const tmpJdFile = join(tmpDir, 'jd.txt');
  writeFileSync(tmpJdFile, jdText, 'utf-8');

  let result;
  try {
    result = JSON.parse(runNode(['jd-skill-gap.mjs', tmpJdFile]));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const matchPct = computeMatchPct(result);
  const sidecar = {
    reportNum,
    url,
    matchPct,
    existing: result.existing || [],
    supportedByResume: result.supportedByResume || [],
    gap: result.gap || [],
    lowConfidence: result.lowConfidence || null,
    computedAt: new Date().toISOString(),
  };

  const sidecarPath = `reports/${String(reportNum).padStart(3, '0')}-ats-match.json`;
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n', 'utf-8');

  if (matchPct === null) {
    console.log(`Report #${reportNum}: no JD skills classified — see ${sidecarPath} (lowConfidence: ${result.lowConfidence?.reason || 'unknown'}).`);
  } else {
    console.log(`Report #${reportNum} ATS keyword match: ${matchPct}% (${sidecar.existing.length} existing + ${sidecar.supportedByResume.length} supported / ${sidecar.gap.length} gaps) -> ${sidecarPath}`);
  }
}

function runSelfTest() {
  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.error(`FAIL: ${name}`); } };

  check('parses padded report number', reportNumFromFilename('reports/042-acme-2026-08-18.md') === 42);
  check('parses unpadded report number', reportNumFromFilename('reports/7-acme-2026-08-18.md') === 7);
  check('returns null for a non-conforming filename', reportNumFromFilename('reports/acme-notes.md') === null);

  const state = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
    + '1\thttps://a.example/1\tcompleted\tt1\tt2\t42\t4.1\t\t0\n'
    + '2\thttps://b.example/2\tfailed\tt1\t\t\t\ttimeout\t2\n';
  check('finds url for a report_num that exists', urlForReportNum(state, 42) === 'https://a.example/1');
  check('returns null for a report_num with no row (failed before claiming a number)', urlForReportNum(state, 99) === null);

  check('computes match pct: 3 found / 1 gap -> 75%', computeMatchPct({ existing: ['a', 'b'], supportedByResume: ['c'], gap: ['d'] }) === 75);
  check('all found -> 100%', computeMatchPct({ existing: ['a'], supportedByResume: [], gap: [] }) === 100);
  check('all gap -> 0%', computeMatchPct({ existing: [], supportedByResume: [], gap: ['a'] }) === 0);
  check('zero classified skills -> null, not 0', computeMatchPct({ existing: [], supportedByResume: [], gap: [] }) === null);

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
