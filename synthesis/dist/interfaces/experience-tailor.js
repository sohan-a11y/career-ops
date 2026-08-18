/**
 * IExperienceTailor
 *
 * Asynchronous service that resolves aligned bullet-point highlights
 * and tailored titles for each employment entry, keyed by companyId.
 *
 * The tailor reads the user's raw employment achievements (from cv.md
 * or equivalent) and rewrites them to foreground the skills and metrics
 * that best match the target requirements matrix.
 *
 * Concrete implementations may use LLM rewriting, template substitution,
 * or retrieval-augmented generation — the orchestrator is agnostic.
 *
 * OUT OF SCOPE for this sprint: the actual tailoring algorithm.
 */
export {};
//# sourceMappingURL=experience-tailor.js.map