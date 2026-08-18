/**
 * Synthesis Pipeline Error Taxonomy
 *
 * Each error carries:
 *   - stage:   which pipeline stage failed
 *   - cause:   the original error (if wrapping)
 *   - context: machine-readable metadata for telemetry
 */
export class SynthesisError extends Error {
    stage;
    context;
    constructor(stage, message, options) {
        super(`[${stage}] ${message}`, { cause: options?.cause });
        this.name = 'SynthesisError';
        this.stage = stage;
        this.context = Object.freeze(options?.context ?? {});
    }
}
/**
 * Thrown when the merge algorithm detects irrecoverable inconsistency
 * between the immutable profile and mutable payload.
 */
export class MergeConflictError extends SynthesisError {
    orphanedKeys;
    constructor(message, orphanedKeys, options) {
        super('merge', message, options);
        this.name = 'MergeConflictError';
        this.orphanedKeys = Object.freeze([...orphanedKeys]);
    }
}
/**
 * Thrown when a pipeline stage exceeds its deadline.
 */
export class StageTimeoutError extends SynthesisError {
    deadlineMs;
    elapsedMs;
    constructor(stage, deadlineMs, elapsedMs, options) {
        super(stage, `Stage "${stage}" timed out after ${elapsedMs}ms (deadline: ${deadlineMs}ms)`, options);
        this.name = 'StageTimeoutError';
        this.deadlineMs = deadlineMs;
        this.elapsedMs = elapsedMs;
    }
}
//# sourceMappingURL=synthesis-errors.js.map