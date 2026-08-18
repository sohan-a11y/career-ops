/**
 * Synthesis Pipeline Error Taxonomy
 *
 * Each error carries:
 *   - stage:   which pipeline stage failed
 *   - cause:   the original error (if wrapping)
 *   - context: machine-readable metadata for telemetry
 */
export type SynthesisStage = 'extract' | 'analyze' | 'synthesize' | 'tailor' | 'merge' | 'compile' | 'score';
export declare class SynthesisError extends Error {
    readonly stage: SynthesisStage;
    readonly context: Readonly<Record<string, unknown>>;
    constructor(stage: SynthesisStage, message: string, options?: {
        cause?: unknown;
        context?: Record<string, unknown>;
    });
}
/**
 * Thrown when the merge algorithm detects irrecoverable inconsistency
 * between the immutable profile and mutable payload.
 */
export declare class MergeConflictError extends SynthesisError {
    readonly orphanedKeys: readonly string[];
    constructor(message: string, orphanedKeys: readonly string[], options?: {
        cause?: unknown;
        context?: Record<string, unknown>;
    });
}
/**
 * Thrown when a pipeline stage exceeds its deadline.
 */
export declare class StageTimeoutError extends SynthesisError {
    readonly deadlineMs: number;
    readonly elapsedMs: number;
    constructor(stage: SynthesisStage, deadlineMs: number, elapsedMs: number, options?: {
        cause?: unknown;
    });
}
//# sourceMappingURL=synthesis-errors.d.ts.map