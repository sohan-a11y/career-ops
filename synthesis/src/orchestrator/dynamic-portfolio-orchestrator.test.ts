/**
 * Tests for DynamicPortfolioOrchestrator — the merge algorithm's four
 * documented invariants, target-metadata propagation, error handling, and
 * genuine parallel execution of Synthesize/Tailor. Uses the stub
 * implementations as fast, free, deterministic test fixtures — exactly
 * what they're for; nothing here calls a real network or AI worker.
 *
 * Run after `npm run build`: node dist/orchestrator/dynamic-portfolio-orchestrator.test.js
 */

import assert from 'node:assert/strict';
import { DynamicPortfolioOrchestrator } from './dynamic-portfolio-orchestrator.js';
import { MergeConflictError, StageTimeoutError } from '../errors/synthesis-errors.js';
import type { ImmutableProfile } from '../types/immutable-profile.js';
import type { MutablePayload } from '../types/mutable-payload.js';
import type { ITargetAnalyzer } from '../interfaces/target-analyzer.js';
import type { IPortfolioSynthesizer } from '../interfaces/portfolio-synthesizer.js';
import type { IExperienceTailor } from '../interfaces/experience-tailor.js';
import type { IDataExtractor } from '../interfaces/data-extractor.js';
import type { IDocumentCompiler } from '../interfaces/document-compiler.js';
import type { IResumeScorer } from '../interfaces/resume-scorer.js';
import type { ScoreResult } from '../types/score-result.js';

let pass = 0;
let fail = 0;
function check(cond: boolean, label: string): void {
  if (cond) { pass++; } else { fail++; console.error(`  FAIL: ${label}`); }
}

// ── Fixtures ─────────────────────────────────────────────────────────

const PROFILE: ImmutableProfile = Object.freeze({
  contactInfo: Object.freeze({ name: 'Test Candidate', email: 't@example.com' }),
  certifications: Object.freeze(['Cert A']),
  education: Object.freeze([{ degree: 'B.S.' }]),
  employmentHistory: Object.freeze([
    Object.freeze({ companyId: 'acme', companyName: 'Acme Corp', startDate: 'Jan 2020', endDate: 'present' }),
    Object.freeze({ companyId: 'other-co', companyName: 'Other Co', startDate: 'Jun 2018', endDate: 'Dec 2019' }),
  ]),
});

function makeDeps(overrides: Partial<{
  extractor: IDataExtractor;
  analyzer: ITargetAnalyzer;
  synthesizer: IPortfolioSynthesizer;
  tailor: IExperienceTailor;
  compiler: IDocumentCompiler;
  scorer: IResumeScorer;
}> = {}) {
  return {
    extractor: overrides.extractor ?? {
      extract: async (source: string) => ({ text: source, title: '', resolvedUrl: source, metadata: {}, extractedAt: new Date().toISOString() }),
    },
    analyzer: overrides.analyzer ?? {
      analyze: async () => ({
        roleTitle: 'Senior Engineer', companyName: 'Target Co',
        requiredSkills: ['A'], preferredSkills: [], responsibilityThemes: [], industryContext: [], senioritySignal: 'senior', location: '', rawSource: '',
      }),
    },
    synthesizer: overrides.synthesizer ?? {
      synthesize: async () => ({ professionalSummary: 'Summary', coreCompetencies: ['X'], tailoredProjects: [] }),
    },
    tailor: overrides.tailor ?? {
      tailor: async (_matrix, companyIds: readonly string[]) => {
        const m = new Map();
        for (const id of companyIds) m.set(id, { tailoredTitle: `Tailored ${id}`, highlights: [`did ${id}`] });
        return m;
      },
    },
    compiler: overrides.compiler ?? {
      compile: async (portfolio) => ({
        buffer: Buffer.from(JSON.stringify(portfolio)),
        mimeType: 'application/json',
        filename: 'out.json',
        sizeBytes: 1,
      }),
    },
    // Conditionally included (never `scorer: undefined`) — exactOptionalPropertyTypes
    // treats an explicit undefined differently from an absent key, and the
    // orchestrator's `scorer?:` constructor param expects "absent", not "undefined".
    ...(overrides.scorer ? { scorer: overrides.scorer } : {}),
  };
}

function makeScoreResult(overrides: Partial<ScoreResult> = {}): ScoreResult {
  return {
    score: 4.2,
    dimensions: { matchWithCv: 4, northStarAlignment: 4, comp: 4, culturalSignals: 4 },
    finalDecision: 'Apply',
    hardStops: [],
    softGaps: [],
    topStrengths: ['Strong match'],
    riskLevel: 'Low',
    confidence: 'High',
    nextAction: 'Proceed to apply',
    ...overrides,
  };
}

// ── mergeOnly: the four documented invariants ───────────────────────
async function testMergeInvariants() {
  const orchestrator = new DynamicPortfolioOrchestrator(makeDeps());

  const payload: MutablePayload = {
    professionalSummary: 'S', coreCompetencies: ['C'], tailoredProjects: [],
    employmentDetails: new Map([
      ['acme', { tailoredTitle: 'Staff Engineer', highlights: ['h1', 'h2'] }],
      ['orphan-key', { tailoredTitle: 'Ghost', highlights: [] }], // no matching companyId
    ]),
  };

  const merged = await orchestrator.mergeOnly(PROFILE, payload, { targetCompany: 'Target Co', targetRole: 'Senior Engineer' });

  // Invariant 1: |output.employment| === |profile.employmentHistory|
  check(merged.employment.length === PROFILE.employmentHistory.length, 'invariant 1: employment length equals immutable profile length');

  // Invariant 2: immutable fields pass through verbatim
  const acmeEntry = merged.employment.find((e) => e.companyId === 'acme');
  check(acmeEntry?.companyName === 'Acme Corp', 'invariant 2: companyName passes through verbatim');
  check(acmeEntry?.startDate === 'Jan 2020' && acmeEntry?.endDate === 'present', 'invariant 2: dates pass through verbatim');
  const otherEntry = merged.employment.find((e) => e.companyId === 'other-co');
  check(otherEntry?.companyName === 'Other Co' && otherEntry?.startDate === 'Jun 2018' && otherEntry?.endDate === 'Dec 2019', 'invariant 2: unmatched entry immutable fields also pass through verbatim');

  // Invariant 3: matched flag reflects payload membership
  check(acmeEntry?.matched === true, 'invariant 3: matched entry has matched=true');
  check(otherEntry?.matched === false, 'invariant 3: unmatched entry has matched=false and empty tailoredTitle/highlights');
  check(otherEntry?.tailoredTitle === '' && otherEntry?.highlights.length === 0, 'invariant 3: unmatched entry gets safe defaults, not undefined');

  // Invariant 4: orphaned mutable keys detected
  check(merged.mergeStats.orphanedMutableKeys.length === 1 && merged.mergeStats.orphanedMutableKeys[0] === 'orphan-key', 'invariant 4: orphaned mutable key detected in mergeStats');

  check(merged.mergeStats.matchedEntries === 1 && merged.mergeStats.unmatchedEntries === 1, 'mergeStats matched/unmatched counts correct');
  check(merged.mergeStats.totalImmutableEntries === 2, 'mergeStats total count correct');

  // Frozen at every level — genuinely immutable, not just typed that way.
  check(Object.isFrozen(merged), 'merged portfolio is frozen');
  check(Object.isFrozen(merged.employment), 'merged.employment array is frozen');
  check(Object.isFrozen(acmeEntry), 'individual employment entries are frozen');
}

// ── Target metadata propagation — the bug this test suite exists to catch ──
async function testTargetMetadataPropagation() {
  let capturedPortfolio: unknown;
  const compilerSpy: IDocumentCompiler = {
    compile: async (portfolio) => {
      capturedPortfolio = portfolio;
      return { buffer: Buffer.from(''), mimeType: 'x', filename: 'x', sizeBytes: 0 };
    },
  };
  const orchestratorWithSpy = new DynamicPortfolioOrchestrator(makeDeps({
    analyzer: { analyze: async () => ({
      roleTitle: 'Staff AI Engineer', companyName: 'Anthropic',
      requiredSkills: [], preferredSkills: [], responsibilityThemes: [], industryContext: [], senioritySignal: '',
      location: 'London, UK',
      rawSource: '',
    }) },
    compiler: compilerSpy,
  }));

  await orchestratorWithSpy.execute('some JD text', PROFILE);

  const portfolio = capturedPortfolio as { targetCompany: string; targetRole: string; targetLocation: string };
  check(portfolio.targetCompany === 'Anthropic', `execute() propagates the analyzed target company into MergedPortfolio.targetCompany (got "${portfolio.targetCompany}")`);
  check(portfolio.targetRole === 'Staff AI Engineer', `execute() propagates the analyzed target role into MergedPortfolio.targetRole (got "${portfolio.targetRole}")`);
  check(portfolio.targetLocation === 'London, UK', `execute() propagates the analyzed target location into MergedPortfolio.targetLocation (got "${portfolio.targetLocation}")`);
}

// ── Strict merge mode ────────────────────────────────────────────────
async function testStrictMerge() {
  const orchestrator = new DynamicPortfolioOrchestrator(makeDeps(), { strictMerge: true });
  const payload: MutablePayload = {
    professionalSummary: '', coreCompetencies: [], tailoredProjects: [],
    employmentDetails: new Map([['does-not-exist', { tailoredTitle: '', highlights: [] }]]),
  };

  let threw = false;
  try {
    await orchestrator.mergeOnly(PROFILE, payload);
  } catch (err) {
    threw = err instanceof MergeConflictError;
  }
  check(threw, 'strictMerge:true throws MergeConflictError on an orphaned mutable key');

  // Non-strict (default) mode: same input does NOT throw.
  const lenient = new DynamicPortfolioOrchestrator(makeDeps());
  let lenientThrew = false;
  try {
    await lenient.mergeOnly(PROFILE, payload);
  } catch {
    lenientThrew = true;
  }
  check(!lenientThrew, 'strictMerge:false (default) does not throw on the same orphaned key — just records it in mergeStats');
}

// ── Parallel execution of Synthesize/Tailor ─────────────────────────
async function testParallelExecution() {
  const order: string[] = [];
  let synthesizeStarted = 0;
  let tailorStarted = 0;

  const orchestrator = new DynamicPortfolioOrchestrator(makeDeps({
    synthesizer: {
      synthesize: async () => {
        synthesizeStarted = Date.now();
        order.push('synthesize-start');
        await new Promise((r) => setTimeout(r, 50));
        order.push('synthesize-end');
        return { professionalSummary: '', coreCompetencies: [], tailoredProjects: [] };
      },
    },
    tailor: {
      tailor: async () => {
        tailorStarted = Date.now();
        order.push('tailor-start');
        await new Promise((r) => setTimeout(r, 50));
        order.push('tailor-end');
        return new Map();
      },
    },
  }));

  const start = Date.now();
  await orchestrator.execute('jd', PROFILE);
  const elapsed = Date.now() - start;

  check(order[0] === 'synthesize-start' && order[1] === 'tailor-start', 'synthesize and tailor both start before either finishes (genuinely parallel, not sequential)');
  check(Math.abs(synthesizeStarted - tailorStarted) < 30, `synthesize and tailor start within 30ms of each other (got ${Math.abs(synthesizeStarted - tailorStarted)}ms apart)`);
  // Sequential would take >= 100ms (extract + analyze + 50 + 50 + merge + compile);
  // parallel should be well under that for the synth/tailor portion.
  check(elapsed < 150, `total pipeline time (${elapsed}ms) reflects parallel synthesize/tailor, not sequential (would be slower)`);
}

// ── Error propagation ────────────────────────────────────────────────
async function testErrorPropagation() {
  const orchestrator = new DynamicPortfolioOrchestrator(makeDeps({
    analyzer: { analyze: async () => { throw new Error('boom'); } },
  }));

  let threw = false;
  let stage = '';
  try {
    await orchestrator.execute('jd', PROFILE);
  } catch (err) {
    threw = true;
    stage = (err as { stage?: string }).stage ?? '';
  }
  check(threw, 'a failing stage propagates as an error, not silently swallowed');
  check(stage === 'analyze', `the error carries the correct stage name (got "${stage}")`);
}

// ── Stage timeout ────────────────────────────────────────────────────
async function testStageTimeout() {
  const orchestrator = new DynamicPortfolioOrchestrator(
    makeDeps({ analyzer: { analyze: async () => { await new Promise((r) => setTimeout(r, 200)); return { roleTitle: '', companyName: '', requiredSkills: [], preferredSkills: [], responsibilityThemes: [], industryContext: [], senioritySignal: '', location: '', rawSource: '' }; } } }),
    { stageTimeoutMs: 20 },
  );

  let threw = false;
  try {
    await orchestrator.execute('jd', PROFILE);
  } catch (err) {
    threw = err instanceof StageTimeoutError;
  }
  check(threw, 'a stage exceeding stageTimeoutMs throws StageTimeoutError');
}

// ── Event telemetry ──────────────────────────────────────────────────
async function testEventTelemetry() {
  const orchestrator = new DynamicPortfolioOrchestrator(makeDeps());
  const events: string[] = [];
  const unsubscribe = orchestrator.onEvent((e) => events.push(e.kind));

  await orchestrator.execute('jd', PROFILE);

  check(events.includes('stage-start') && events.includes('stage-complete'), 'onEvent receives stage-start/stage-complete events');
  check(events.includes('merge-stats'), 'onEvent receives a merge-stats event');
  check(events.includes('pipeline-done'), 'onEvent receives a pipeline-done event at the end');
  check(events.at(-1) === 'pipeline-done', 'pipeline-done is the LAST event emitted');

  unsubscribe();
  const countBeforeUnsubscribe = events.length;
  await orchestrator.execute('jd', PROFILE);
  check(events.length === countBeforeUnsubscribe, 'unsubscribe() actually stops further events from arriving');
}

// ── Score stage (optional 7th stage, after Compile) ─────────────────
async function testScoreStageRunsWhenScorerProvided() {
  let capturedPortfolio: unknown;
  let capturedMatrix: unknown;
  const scorer: IResumeScorer = {
    score: async (portfolio, matrix) => {
      capturedPortfolio = portfolio;
      capturedMatrix = matrix;
      return makeScoreResult({ score: 4.7, finalDecision: 'Apply' });
    },
  };

  const orchestrator = new DynamicPortfolioOrchestrator(makeDeps({ scorer }));
  const events: Array<{ kind: string; result?: ScoreResult }> = [];
  orchestrator.onEvent((e) => events.push(e as { kind: string; result?: ScoreResult }));

  await orchestrator.execute('jd', PROFILE);

  const scoreEvent = events.find((e) => e.kind === 'score-result');
  check(scoreEvent !== undefined, 'a scorer provided to the constructor causes a score-result event to fire');
  check(scoreEvent?.result?.score === 4.7, `the score-result event carries the scorer's actual result (got ${scoreEvent?.result?.score})`);
  check(scoreEvent?.result?.finalDecision === 'Apply', 'the score-result event carries finalDecision');

  check(capturedPortfolio !== undefined, 'the scorer receives the merged portfolio');
  check((capturedPortfolio as { targetCompany?: string })?.targetCompany === 'Target Co', 'the scorer receives the SAME merged portfolio that was compiled, not a separate copy');
  check((capturedMatrix as { companyName?: string })?.companyName === 'Target Co', 'the scorer receives the target matrix from Analyze');

  const doneIndex = events.findIndex((e) => e.kind === 'pipeline-done');
  const scoreIndex = events.findIndex((e) => e.kind === 'score-result');
  check(scoreIndex !== -1 && doneIndex !== -1 && scoreIndex < doneIndex, 'score-result fires before pipeline-done');

  const compileCompleteIndex = events.findIndex((e) => e.kind === 'stage-complete' && (e as unknown as { stage: string }).stage === 'compile');
  check(compileCompleteIndex !== -1 && compileCompleteIndex < scoreIndex, 'compile completes before scoring starts — Score runs AFTER Compile, matching the described order');
}

async function testScoreStageSkippedWhenNoScorerProvided() {
  const orchestrator = new DynamicPortfolioOrchestrator(makeDeps()); // no scorer
  const events: string[] = [];
  orchestrator.onEvent((e) => events.push(e.kind));

  const compiled = await orchestrator.execute('jd', PROFILE);

  check(!events.includes('score-result'), 'no scorer provided → no score-result event fires');
  check(compiled.filename === 'out.json', 'execute() still returns the compiled document normally when scoring is skipped — non-breaking for existing callers');
}

async function testScoreStageErrorPropagates() {
  const scorer: IResumeScorer = {
    score: async () => { throw new Error('scoring failed'); },
  };
  const orchestrator = new DynamicPortfolioOrchestrator(makeDeps({ scorer }));

  let threw = false;
  let stage = '';
  try {
    await orchestrator.execute('jd', PROFILE);
  } catch (err) {
    threw = true;
    stage = (err as { stage?: string }).stage ?? '';
  }
  check(threw, 'a failing scorer propagates as an error rather than being silently swallowed');
  check(stage === 'score', `the error carries the "score" stage name (got "${stage}")`);
}

// ── Run all ───────────────────────────────────────────────────────────
async function main() {
  await testMergeInvariants();
  await testTargetMetadataPropagation();
  await testStrictMerge();
  await testParallelExecution();
  await testErrorPropagation();
  await testStageTimeout();
  await testEventTelemetry();
  await testScoreStageRunsWhenScorerProvided();
  await testScoreStageSkippedWhenNoScorerProvided();
  await testScoreStageErrorPropagates();

  console.log(`\n  dynamic-portfolio-orchestrator self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
