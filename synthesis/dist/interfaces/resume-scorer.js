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
export {};
//# sourceMappingURL=resume-scorer.js.map