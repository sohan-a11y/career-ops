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
import type { TargetMatrix } from '../types/target-matrix.js';
import type { MutableEmploymentData } from '../types/mutable-payload.js';
export interface IExperienceTailor {
    /**
     * Produce tailored titles and highlights for each employment entry.
     *
     * @param matrix    - The requirements matrix from ITargetAnalyzer.
     * @param companyIds - The companyId list from the immutable profile,
     *                     so the tailor knows which entries to produce
     *                     data for.  Order matches employmentHistory order.
     * @returns Map from companyId to tailored employment data.
     * @throws SynthesisError with stage = 'tailor' on failure.
     */
    tailor(matrix: TargetMatrix, companyIds: readonly string[]): Promise<ReadonlyMap<string, MutableEmploymentData>>;
}
//# sourceMappingURL=experience-tailor.d.ts.map