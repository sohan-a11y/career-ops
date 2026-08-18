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
import type { ImmutableProfile } from '../types/immutable-profile.js';
import type { MutablePayload } from '../types/mutable-payload.js';
import type { MergedPortfolio, MergeStats } from '../types/merged-output.js';
import type { ScoreResult } from '../types/score-result.js';
import type { ITargetAnalyzer } from '../interfaces/target-analyzer.js';
import type { IPortfolioSynthesizer } from '../interfaces/portfolio-synthesizer.js';
import type { IExperienceTailor } from '../interfaces/experience-tailor.js';
import type { IDataExtractor } from '../interfaces/data-extractor.js';
import type { IDocumentCompiler, CompiledDocument } from '../interfaces/document-compiler.js';
import type { IResumeScorer } from '../interfaces/resume-scorer.js';
import { type SynthesisStage } from '../errors/synthesis-errors.js';
export interface OrchestratorConfig {
    /**
     * Per-stage timeout in milliseconds.
     * Stages that exceed their deadline throw StageTimeoutError.
     * Default: 30 000 ms (30 seconds) per stage.
     */
    readonly stageTimeoutMs?: number | undefined;
    /**
     * When true, orphaned mutable keys (keys in the payload that have
     * no matching companyId in the immutable profile) cause a
     * MergeConflictError instead of being silently recorded in
     * mergeStats.orphanedMutableKeys.
     *
     * Default: false (lenient — orphans are logged, not fatal).
     */
    readonly strictMerge?: boolean | undefined;
    /**
     * AbortSignal for cooperative cancellation.
     * The orchestrator checks the signal before each stage and
     * propagates it to stage implementations where supported.
     */
    readonly signal?: AbortSignal | undefined;
}
export type PipelineEvent = {
    readonly kind: 'stage-start';
    readonly stage: SynthesisStage;
    readonly timestamp: string;
} | {
    readonly kind: 'stage-complete';
    readonly stage: SynthesisStage;
    readonly durationMs: number;
    readonly timestamp: string;
} | {
    readonly kind: 'stage-error';
    readonly stage: SynthesisStage;
    readonly error: string;
    readonly timestamp: string;
} | {
    readonly kind: 'merge-stats';
    readonly stats: MergeStats;
    readonly timestamp: string;
} | {
    readonly kind: 'score-result';
    readonly result: ScoreResult;
    readonly timestamp: string;
} | {
    readonly kind: 'pipeline-done';
    readonly totalMs: number;
    readonly timestamp: string;
};
export type EventListener = (event: PipelineEvent) => void;
export declare class DynamicPortfolioOrchestrator {
    private readonly analyzer;
    private readonly synthesizer;
    private readonly tailor;
    private readonly extractor;
    private readonly compiler;
    private readonly scorer;
    private readonly config;
    private readonly listeners;
    constructor(deps: {
        analyzer: ITargetAnalyzer;
        synthesizer: IPortfolioSynthesizer;
        tailor: IExperienceTailor;
        extractor: IDataExtractor;
        compiler: IDocumentCompiler;
        /** Optional — when omitted, the pipeline stops after Compile and never emits a 'score-result' event. */
        scorer?: IResumeScorer;
    }, config?: OrchestratorConfig);
    /**
     * Subscribe to pipeline events.  Returns an unsubscribe function.
     * Listeners are invoked synchronously in registration order.
     */
    onEvent(listener: EventListener): () => void;
    /**
     * Execute the full pipeline:
     *   Extract → Analyze → [Synthesize ‖ Tailor] → Merge → Compile
     *
     * @param source   - JD source (URL, raw text, or file path).
     * @param profile  - The locked immutable profile.
     * @returns The compiled document buffer with metadata.
     */
    execute(source: string, profile: ImmutableProfile): Promise<CompiledDocument>;
    /**
     * Run only the merge stage — useful for testing or when the
     * mutable payload is pre-computed.
     */
    mergeOnly(profile: ImmutableProfile, payload: MutablePayload, target?: {
        targetCompany?: string;
        targetRole?: string;
        targetLocation?: string;
    }): Promise<MergedPortfolio>;
    private mergeState;
    private runStage;
    /**
     * Run two stages in parallel.  Both must succeed — if either fails
     * the entire pipeline aborts with the first error.
     */
    private runParallelStages;
    private timeoutPromise;
    private checkAborted;
    private emit;
}
//# sourceMappingURL=dynamic-portfolio-orchestrator.d.ts.map