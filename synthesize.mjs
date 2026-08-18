#!/usr/bin/env node
/**
 * synthesize.mjs — real, end-to-end run of the Dynamic Portfolio Synthesis
 * Pipeline against the user's actual cv.md/config/profile.yml.
 *
 * This is the CLI front door for career-ops/synthesis/ — the TypeScript
 * package that implements Extract → Analyze → [Synthesize ‖ Tailor] →
 * Merge → Compile → Score. Every stage is a REAL implementation:
 *   - Extract   → browser-extract.mjs (existing headless JD reader)
 *   - Analyze   → headless `claude -p` worker, same context every mode reads
 *   - Synthesize/Tailor → headless `claude -p` workers, reading REAL cv.md
 *   - Merge     → deterministic TypeScript join (career-ops/synthesis/src)
 *   - Compile   → build-cv-html.mjs → verify-cv-facts.mjs (hard gate) →
 *                 generate-pdf.mjs (existing rendering chain)
 *   - Score     → headless `claude -p` worker, SAME 5-dimension rubric as
 *                 modes/_shared.md, judging the COMPILED tailored resume
 *
 * This script does NOT open a browser or fill an application form — that
 * capability already exists, more maturely, in `modes/apply.md` (knock-out
 * question warnings, per-ATS quirks, jurisdiction checks, and a hard rule
 * that never auto-submits). On a passing score this script prints clear
 * next-step guidance pointing there; it never drives a browser itself.
 *
 * Usage:
 *   node synthesize.mjs <jd-url-or-file> [--format=letter|a4] [--no-score] [--verbose]
 *
 * Requires: `npm run build` in synthesis/ (compiles src/ → dist/).
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const SYNTHESIS_DIST = join(CAREER_OPS, 'synthesis', 'dist', 'index.js');

const USAGE = `Usage:
  node synthesize.mjs <jd-url-or-file> [options]
  node synthesize.mjs --help

Runs the full Dynamic Portfolio Synthesis Pipeline against your real
cv.md + config/profile.yml: Extract the JD → Analyze requirements →
Synthesize + Tailor (parallel, real headless AI calls) → Merge
(deterministic, immutable facts pass through untouched) → Compile to PDF
→ Score the compiled resume against the JD (same rubric as every other
career-ops evaluation).

Options:
  --format=letter|a4   Force page format. Omit to auto-detect from the
                        JD's stated location (US/Canada → letter, else a4).
  --output=NAME         Output basename (no extension) under output/.
                        Omit for the default cv-{candidate}-{company}.
  --report=NNN           Link the PDF to this report number in
                        data/pdf-index.tsv, same as generate-pdf.mjs
                        --report — omit for a one-off PDF with no tracker
                        entry.
  --no-score            Skip the Score stage — just produce the tailored
                        PDF.
  --verbose              Print full error context/cause on failure.

Each Analyze/Synthesize/Tailor/Score stage spawns a real 'claude -p'
worker at the model your config/profile.yml spend_tier resolves to — this
costs real tokens, same as any other career-ops evaluation.

This script never opens a browser or fills an application form. On a
passing score it tells you to run the existing, more mature \`apply\` mode
for that — this script's job ends at "here is your scored, tailored PDF."
`;

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }

  // No default here — leaving `format` undefined when --format isn't
  // passed lets RealDocumentCompiler auto-detect letter-vs-a4 from the
  // JD's stated location. A hardcoded 'letter' default here would silently
  // override that detection on every single run — this bug existed until
  // this pass caught it, so any run without an explicit --format was
  // always forcing letter format regardless of the target's location.
  const formatArg = args.find((a) => a.startsWith('--format='));
  const format = formatArg ? formatArg.split('=')[1] : undefined;
  if (format !== undefined && format !== 'letter' && format !== 'a4') {
    console.error(`Error: --format must be "letter" or "a4", got "${format}"`);
    process.exit(1);
  }

  const outputArg = args.find((a) => a.startsWith('--output='));
  const output = outputArg ? outputArg.split('=').slice(1).join('=') : undefined;

  const reportArg = args.find((a) => a.startsWith('--report='));
  const report = reportArg ? reportArg.split('=')[1] : undefined;

  const positional = args.find((a) => !a.startsWith('-'));
  return {
    source: positional ?? null,
    format,
    output,
    report,
    score: !args.includes('--no-score'),
    verbose: args.includes('--verbose'),
  };
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.source) {
    console.error('Error: no job description URL or file given.\n');
    console.log(USAGE);
    process.exit(1);
  }

  if (!existsSync(SYNTHESIS_DIST)) {
    console.error(`Error: ${SYNTHESIS_DIST} not found.\nRun this first: cd synthesis && npm run build`);
    process.exit(1);
  }

  const synthesis = await import(pathToFileURL(SYNTHESIS_DIST).href);
  const {
    DynamicPortfolioOrchestrator,
    loadImmutableProfile,
    RealDataExtractor,
    RealTargetAnalyzer,
    RealPortfolioSynthesizer,
    RealExperienceTailor,
    RealDocumentCompiler,
    RealResumeScorer,
  } = synthesis;

  // A bare local file path (no scheme) is read directly rather than handed
  // to browser-extract.mjs, which expects a real URL to navigate to.
  let source = opts.source;
  if (existsSync(resolve(opts.source)) && !/^https?:\/\//i.test(opts.source)) {
    console.log(`  Reading JD from local file: ${resolve(opts.source)}`);
    source = readFileSync(resolve(opts.source), 'utf-8');
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Dynamic Portfolio Synthesis Pipeline — REAL run         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  const cvPath = join(CAREER_OPS, 'cv.md');
  const profileYamlPath = join(CAREER_OPS, 'config', 'profile.yml');
  console.log(`  Profile:  ${cvPath}`);
  console.log(`  Config:   ${profileYamlPath}`);
  console.log('');

  const profile = loadImmutableProfile({ cvPath, profileYamlPath });
  console.log(`  Loaded ${profile.employmentHistory.length} employment record(s), ${profile.certifications.length} certification(s) for ${profile.contactInfo.name ?? '(no name in profile.yml)'}`);
  console.log('');

  const isLocalFileSource = source !== opts.source; // already-read raw text, not a URL

  const orchestrator = new DynamicPortfolioOrchestrator(
    {
      extractor: isLocalFileSource
        ? { extract: async (text) => ({ text, title: '', resolvedUrl: opts.source, metadata: {}, extractedAt: new Date().toISOString() }) }
        : new RealDataExtractor({ careerOpsRoot: CAREER_OPS }),
      analyzer: new RealTargetAnalyzer({ careerOpsRoot: CAREER_OPS }),
      synthesizer: new RealPortfolioSynthesizer({ careerOpsRoot: CAREER_OPS }),
      tailor: new RealExperienceTailor({ careerOpsRoot: CAREER_OPS }),
      compiler: new RealDocumentCompiler({
        careerOpsRoot: CAREER_OPS,
        ...(opts.format ? { pageFormat: opts.format } : {}), // omitted → auto-detect from JD location
        ...(opts.output ? { outputFilename: opts.output } : {}),
        ...(opts.report ? { reportNumber: opts.report } : {}),
      }),
      ...(opts.score ? { scorer: new RealResumeScorer({ careerOpsRoot: CAREER_OPS }) } : {}),
    },
    { stageTimeoutMs: 240_000 }, // headless AI calls can genuinely take a few minutes
  );

  const stageIcons = { extract: '🔍', analyze: '🧠', synthesize: '⚡', tailor: '✂️', merge: '🔗', compile: '📄', score: '🎯' };
  let scoreResult = null;
  orchestrator.onEvent((event) => {
    const icon = 'stage' in event ? (stageIcons[event.stage] ?? '•') : '•';
    if (event.kind === 'stage-start') console.log(`  ${icon}  ${event.stage} started…`);
    if (event.kind === 'stage-complete') console.log(`  ${icon}  ${event.stage} done (${(event.durationMs / 1000).toFixed(1)}s)`);
    if (event.kind === 'stage-error') console.log(`  ❌  ${event.stage} FAILED: ${event.error}`);
    if (event.kind === 'merge-stats') {
      console.log('');
      console.log(`  📊  Merge stats: ${event.stats.matchedEntries}/${event.stats.totalImmutableEntries} roles matched, ${event.stats.unmatchedEntries} unmatched`);
      if (event.stats.orphanedMutableKeys.length > 0) {
        console.log(`      ⚠️  Orphaned mutable keys (no immutable match): ${event.stats.orphanedMutableKeys.join(', ')}`);
      }
      console.log('');
    }
    if (event.kind === 'score-result') scoreResult = event.result;
    if (event.kind === 'pipeline-done') console.log(`\n  ✅  Pipeline complete (${(event.totalMs / 1000).toFixed(1)}s total)\n`);
  });

  try {
    const compiled = await orchestrator.execute(source, profile);
    console.log('─── Output ──────────────────────────────────────────────────');
    console.log(`  File: output/${compiled.filename}`);
    console.log(`  Size: ${(compiled.sizeBytes / 1024).toFixed(1)} KB`);
    console.log('');

    if (scoreResult) {
      printScoreResult(scoreResult);
    }
  } catch (err) {
    console.error('\nPipeline failed:');
    console.error(`  Stage:   ${err.stage ?? '(unknown)'}`);
    console.error(`  Message: ${err.message}`);
    if (opts.verbose && err.context) console.error(`  Context: ${JSON.stringify(err.context, null, 2)}`);
    if (opts.verbose && err.cause) console.error(`  Cause:   ${err.cause instanceof Error ? err.cause.stack : err.cause}`);
    process.exit(1);
  }
}

function printScoreResult(result) {
  const decisionIcon = { Apply: '✅', Consider: '🟡', 'Research first': '🔎', Skip: '⛔' }[result.finalDecision] ?? '•';

  console.log('─── Score ───────────────────────────────────────────────────');
  console.log(`  Global:   ${result.score.toFixed(1)}/5  ${decisionIcon} ${result.finalDecision}`);
  console.log(`  Dimensions:`);
  console.log(`    Match with CV:        ${result.dimensions.matchWithCv}/5`);
  console.log(`    North Star alignment: ${result.dimensions.northStarAlignment}/5`);
  console.log(`    Comp:                 ${result.dimensions.comp}/5`);
  console.log(`    Cultural signals:     ${result.dimensions.culturalSignals}/5`);
  console.log(`  Risk: ${result.riskLevel}   Confidence: ${result.confidence}`);
  console.log('');

  if (result.hardStops.length > 0) {
    console.log('  🚫 Hard stops:');
    result.hardStops.forEach((s) => console.log(`     - ${s}`));
    console.log('');
  }
  if (result.topStrengths.length > 0) {
    console.log('  💪 Top strengths:');
    result.topStrengths.forEach((s) => console.log(`     - ${s}`));
    console.log('');
  }
  if (result.softGaps.length > 0) {
    console.log('  ⚠️  Soft gaps:');
    result.softGaps.forEach((s) => console.log(`     - ${s}`));
    console.log('');
  }

  console.log(`  Next: ${result.nextAction}`);
  console.log('');

  // Score interpretation from modes/_shared.md: 3.5+ is at least "Consider".
  // This script's job ends here — the actual browser-driven form filling
  // (knock-out warnings, jurisdiction checks, per-ATS quirks, and the hard
  // rule that never auto-submits) already exists in modes/apply.md.
  if (result.finalDecision === 'Apply' || result.finalDecision === 'Consider') {
    console.log('  ─────────────────────────────────────────────────────────');
    console.log('  This score clears the bar to proceed. This script does not open a');
    console.log('  browser or fill forms — that\'s /career-ops apply, which already');
    console.log('  handles knock-out questions, per-ATS quirks, and jurisdiction');
    console.log('  checks, and never submits without you reviewing first.');
    console.log('  ─────────────────────────────────────────────────────────');
  } else {
    console.log('  ─────────────────────────────────────────────────────────');
    console.log('  Recommendation: do not proceed to apply — score is below the bar.');
    console.log('  ─────────────────────────────────────────────────────────');
  }
  console.log('');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`synthesize: ${err?.stack || err?.message || err}`);
    process.exit(1);
  });
}
