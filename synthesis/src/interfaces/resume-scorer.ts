/**
 * IResumeScorer
 *
 * Scores the COMPILED, tailored resume (MergedPortfolio) against the
 * target requirements matrix — not raw cv.md. This runs after Merge (and
 * conceptually after Compile, since it judges the same content that was
 * just rendered) so the score reflects what would actually be submitted,
 * not just the candidate's unfiltered background.
 *
 * Optional dependency on the orchestrator: a caller that doesn't need
 * automated scoring (e.g. testing the merge algorithm in isolation)
 * doesn't have to provide one.
 *
 * OUT OF SCOPE for this sprint: the actual scoring algorithm.
 */

import type { MergedPortfolio } from '../types/merged-output.js';
import type { TargetMatrix } from '../types/target-matrix.js';
import type { ScoreResult } from '../types/score-result.js';

export interface IResumeScorer {
  /**
   * Score a compiled portfolio against the target matrix it was tailored
   * for.
   *
   * @param portfolio - The merged, tailored resume content.
   * @param matrix - The target requirements matrix from ITargetAnalyzer.
   * @returns The score result.
   * @throws SynthesisError with stage = 'score' on failure.
   */
  score(portfolio: MergedPortfolio, matrix: TargetMatrix): Promise<ScoreResult>;
}
