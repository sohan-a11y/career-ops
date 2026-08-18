/**
 * Synthesis Pipeline Error Taxonomy
 *
 * Each error carries:
 *   - stage:   which pipeline stage failed
 *   - cause:   the original error (if wrapping)
 *   - context: machine-readable metadata for telemetry
 */

export type SynthesisStage =
  | 'extract'
  | 'analyze'
  | 'synthesize'
  | 'tailor'
  | 'merge'
  | 'compile'
  | 'score';

export class SynthesisError extends Error {
  readonly stage: SynthesisStage;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    stage: SynthesisStage,
    message: string,
    options?: { cause?: unknown; context?: Record<string, unknown> },
  ) {
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
  readonly orphanedKeys: readonly string[];

  constructor(
    message: string,
    orphanedKeys: readonly string[],
    options?: { cause?: unknown; context?: Record<string, unknown> },
  ) {
    super('merge', message, options);
    this.name = 'MergeConflictError';
    this.orphanedKeys = Object.freeze([...orphanedKeys]);
  }
}

/**
 * Thrown when a pipeline stage exceeds its deadline.
 */
export class StageTimeoutError extends SynthesisError {
  readonly deadlineMs: number;
  readonly elapsedMs: number;

  constructor(
    stage: SynthesisStage,
    deadlineMs: number,
    elapsedMs: number,
    options?: { cause?: unknown },
  ) {
    super(stage, `Stage "${stage}" timed out after ${elapsedMs}ms (deadline: ${deadlineMs}ms)`, options);
    this.name = 'StageTimeoutError';
    this.deadlineMs = deadlineMs;
    this.elapsedMs = elapsedMs;
  }
}
