/**
 * Phase 3 — The Synthesis Engine
 *
 * DynamicPortfolioOrchestrator drives the asynchronous pipeline:
 *
 *   Extract → Analyze → [Synthesize ‖ Tailor] → Merge → Compile → Score
 *
 * The synthesize and tailor stages run in parallel because they are
 * independent consumers of the same TargetMatrix — neither reads the
 * other's output.
 *
 * The merge stage is the mathematical core: it joins the immutable
 * profile's employmentHistory (by companyId) with the mutable payload's
 * employmentDetails map.  Dates and company names are never touched;
 * titles and highlights are populated from the payload.
 *
 * Score is optional: a caller that only needs the compiled document (or is
 * testing the merge algorithm in isolation) never has to provide a scorer.
 * When one is provided, it runs after Compile and judges the SAME content
 * that was just rendered — the score reflects what would actually be
 * submitted, not the candidate's unfiltered background. Its result is only
 * available via the 'score-result' event (see PipelineEvent) — execute()'s
 * return type stays CompiledDocument, matching how merge-stats already
 * works, rather than becoming a breaking change to every existing caller.
 *
 * Every stage is behind an abstract interface — this file contains
 * ONLY flow control, error handling, and the merge algorithm.
 */
import { SynthesisError, MergeConflictError, StageTimeoutError, } from '../errors/synthesis-errors.js';
const DEFAULT_STAGE_TIMEOUT_MS = 30_000;
// ── The Orchestrator ───────────────────────────────────────────────
export class DynamicPortfolioOrchestrator {
    analyzer;
    synthesizer;
    tailor;
    extractor;
    compiler;
    scorer;
    config;
    listeners = [];
    constructor(deps, config) {
        this.analyzer = deps.analyzer;
        this.synthesizer = deps.synthesizer;
        this.scorer = deps.scorer;
        this.tailor = deps.tailor;
        this.extractor = deps.extractor;
        this.compiler = deps.compiler;
        this.config = {
            stageTimeoutMs: config?.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS,
            strictMerge: config?.strictMerge ?? false,
            signal: config?.signal,
        };
    }
    // ── Public API ──────────────────────────────────────────────────
    /**
     * Subscribe to pipeline events.  Returns an unsubscribe function.
     * Listeners are invoked synchronously in registration order.
     */
    onEvent(listener) {
        this.listeners.push(listener);
        return () => {
            const idx = this.listeners.indexOf(listener);
            if (idx !== -1)
                this.listeners.splice(idx, 1);
        };
    }
    /**
     * Execute the full pipeline:
     *   Extract → Analyze → [Synthesize ‖ Tailor] → Merge → Compile
     *
     * @param source   - JD source (URL, raw text, or file path).
     * @param profile  - The locked immutable profile.
     * @returns The compiled document buffer with metadata.
     */
    async execute(source, profile) {
        const pipelineStart = performance.now();
        // ── Stage 1: Extract ────────────────────────────────────────
        const extracted = await this.runStage('extract', () => this.extractor.extract(source));
        // ── Stage 2: Analyze ────────────────────────────────────────
        const matrix = await this.runStage('analyze', () => this.analyzer.analyze(extracted.text));
        // ── Stage 3+4: Synthesize and Tailor (parallel) ─────────────
        const companyIds = profile.employmentHistory.map(e => e.companyId);
        const [synthesized, employmentDetails] = await this.runParallelStages({
            stage: 'synthesize',
            fn: () => this.synthesizer.synthesize(matrix),
        }, {
            stage: 'tailor',
            fn: () => this.tailor.tailor(matrix, companyIds),
        });
        // ── Assemble the MutablePayload ─────────────────────────────
        const payload = {
            professionalSummary: synthesized.professionalSummary,
            coreCompetencies: synthesized.coreCompetencies,
            tailoredProjects: synthesized.tailoredProjects,
            employmentDetails,
        };
        // ── Stage 5: Merge ──────────────────────────────────────────
        const merged = await this.runStage('merge', async () => this.mergeState(profile, payload, { targetCompany: matrix.companyName, targetRole: matrix.roleTitle, targetLocation: matrix.location }));
        // ── Stage 6: Compile ────────────────────────────────────────
        const compiled = await this.runStage('compile', () => this.compiler.compile(merged));
        // ── Stage 7: Score (optional) ───────────────────────────────
        // Judges the SAME tailored content that was just compiled — the score
        // reflects what would actually be submitted. Only runs when a scorer
        // was provided; result is only available via the 'score-result' event.
        if (this.scorer) {
            const scoreResult = await this.runStage('score', () => this.scorer.score(merged, matrix));
            this.emit({
                kind: 'score-result',
                result: scoreResult,
                timestamp: new Date().toISOString(),
            });
        }
        // ── Done ────────────────────────────────────────────────────
        const totalMs = performance.now() - pipelineStart;
        this.emit({
            kind: 'pipeline-done',
            totalMs,
            timestamp: new Date().toISOString(),
        });
        return compiled;
    }
    /**
     * Run only the merge stage — useful for testing or when the
     * mutable payload is pre-computed.
     */
    async mergeOnly(profile, payload, target) {
        return this.mergeState(profile, payload, {
            targetCompany: target?.targetCompany ?? '',
            targetRole: target?.targetRole ?? '',
            targetLocation: target?.targetLocation ?? '',
        });
    }
    // ── The Merge Algorithm ─────────────────────────────────────────
    //
    // Mathematical invariants:
    //   1. |output.employment| === |profile.employmentHistory|
    //      Every immutable entry produces exactly one merged entry.
    //
    //   2. For each merged entry e:
    //      e.companyId   === profile.employmentHistory[i].companyId
    //      e.companyName === profile.employmentHistory[i].companyName
    //      e.startDate   === profile.employmentHistory[i].startDate
    //      e.endDate     === profile.employmentHistory[i].endDate
    //      (immutable fields are referentially equal, not just ===)
    //
    //   3. e.matched === payload.employmentDetails.has(e.companyId)
    //
    //   4. orphanedMutableKeys = keys(payload.employmentDetails)
    //        \ keys(profile.employmentHistory.map(h => h.companyId))
    //      (set difference — mutable keys with no immutable match)
    mergeState(profile, payload, target) {
        const immutableIds = new Set(profile.employmentHistory.map(e => e.companyId));
        // Detect orphaned mutable keys (payload entries with no profile match).
        const orphanedMutableKeys = [];
        for (const key of payload.employmentDetails.keys()) {
            if (!immutableIds.has(key)) {
                orphanedMutableKeys.push(key);
            }
        }
        if (this.config.strictMerge && orphanedMutableKeys.length > 0) {
            throw new MergeConflictError(`Strict merge failed: ${orphanedMutableKeys.length} mutable key(s) have no matching companyId in the immutable profile: [${orphanedMutableKeys.join(', ')}]`, orphanedMutableKeys);
        }
        // Map each immutable employment entry to a merged entry.
        // Order is preserved — the output array has the same sequence
        // as profile.employmentHistory.
        const employment = profile.employmentHistory.map((record) => {
            const mutable = payload.employmentDetails.get(record.companyId);
            return Object.freeze({
                // Immutable pass-through (never modified)
                companyId: record.companyId,
                companyName: record.companyName,
                startDate: record.startDate,
                endDate: record.endDate,
                // Mutable (from payload, or defaults when unmatched)
                tailoredTitle: mutable?.tailoredTitle ?? '',
                highlights: Object.freeze([...(mutable?.highlights ?? [])]),
                // Match flag
                matched: mutable !== undefined,
            });
        });
        const stats = Object.freeze({
            totalImmutableEntries: profile.employmentHistory.length,
            matchedEntries: employment.filter(e => e.matched).length,
            unmatchedEntries: employment.filter(e => !e.matched).length,
            orphanedMutableKeys: Object.freeze([...orphanedMutableKeys]),
            mergedAt: new Date().toISOString(),
        });
        this.emit({
            kind: 'merge-stats',
            stats,
            timestamp: stats.mergedAt,
        });
        return Object.freeze({
            // Immutable pass-through
            contactInfo: profile.contactInfo,
            certifications: profile.certifications,
            education: profile.education,
            // Mutable pass-through
            professionalSummary: payload.professionalSummary,
            coreCompetencies: payload.coreCompetencies,
            tailoredProjects: payload.tailoredProjects,
            // Merged employment
            employment: Object.freeze(employment),
            // Target metadata — WHO this was tailored for (see MergedPortfolio's
            // doc comment for why this must never be derived from employment[0])
            targetCompany: target.targetCompany,
            targetRole: target.targetRole,
            targetLocation: target.targetLocation,
            // Metadata
            mergeStats: stats,
        });
    }
    // ── Stage runner with timeout + cancellation ────────────────────
    async runStage(stage, fn) {
        this.checkAborted(stage);
        const timestamp = new Date().toISOString();
        this.emit({ kind: 'stage-start', stage, timestamp });
        const start = performance.now();
        try {
            const result = await Promise.race([
                fn(),
                this.timeoutPromise(stage),
            ]);
            const durationMs = performance.now() - start;
            this.emit({
                kind: 'stage-complete',
                stage,
                durationMs,
                timestamp: new Date().toISOString(),
            });
            return result;
        }
        catch (err) {
            const elapsed = performance.now() - start;
            this.emit({
                kind: 'stage-error',
                stage,
                error: err instanceof Error ? err.message : String(err),
                timestamp: new Date().toISOString(),
            });
            if (err instanceof SynthesisError)
                throw err;
            throw new SynthesisError(stage, `Stage "${stage}" failed`, {
                cause: err,
                context: { elapsedMs: elapsed },
            });
        }
    }
    /**
     * Run two stages in parallel.  Both must succeed — if either fails
     * the entire pipeline aborts with the first error.
     */
    async runParallelStages(a, b) {
        const [resultA, resultB] = await Promise.all([
            this.runStage(a.stage, a.fn),
            this.runStage(b.stage, b.fn),
        ]);
        return [resultA, resultB];
    }
    // ── Helpers ────────────────────────────────────────────────────
    timeoutPromise(stage) {
        const ms = this.config.stageTimeoutMs;
        return new Promise((_, reject) => {
            const timer = setTimeout(() => {
                reject(new StageTimeoutError(stage, ms, ms));
            }, ms);
            // Unref so the timer doesn't prevent Node from exiting
            // when the promise resolves via the race winner.
            if (typeof timer === 'object' && 'unref' in timer) {
                timer.unref();
            }
        });
    }
    checkAborted(stage) {
        if (this.config.signal?.aborted) {
            throw new SynthesisError(stage, 'Pipeline aborted', {
                cause: this.config.signal.reason,
            });
        }
    }
    emit(event) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch {
                // Listener errors are swallowed — telemetry must never
                // crash the pipeline.
            }
        }
    }
}
//# sourceMappingURL=dynamic-portfolio-orchestrator.js.map