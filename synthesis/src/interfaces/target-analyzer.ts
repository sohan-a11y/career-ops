/**
 * ITargetAnalyzer
 *
 * Extracts a structured requirements matrix from a raw job description.
 * Concrete implementations may use NLP, LLM calls, or rule-based parsing —
 * the orchestrator is agnostic to the extraction strategy.
 *
 * OUT OF SCOPE for this sprint: the actual extraction algorithm.
 */

import type { TargetMatrix } from '../types/target-matrix.js';

export interface ITargetAnalyzer {
  /**
   * Parse a job description (raw text or URL) into a TargetMatrix.
   *
   * @param source - Raw JD text or a resolvable URL.
   * @returns The extracted requirements matrix.
   * @throws SynthesisError with stage = 'analyze' on extraction failure.
   */
  analyze(source: string): Promise<TargetMatrix>;
}
