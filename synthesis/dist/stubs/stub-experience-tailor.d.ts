/**
 * Stub IExperienceTailor — rewrites job titles and bullet highlights
 * to match the target role's vocabulary.
 * In production this would use LLM rewriting or RAG.
 */
import type { IExperienceTailor } from '../interfaces/experience-tailor.js';
import type { TargetMatrix } from '../types/target-matrix.js';
import type { MutableEmploymentData } from '../types/mutable-payload.js';
export declare class StubExperienceTailor implements IExperienceTailor {
    tailor(matrix: TargetMatrix, companyIds: readonly string[]): Promise<ReadonlyMap<string, MutableEmploymentData>>;
}
//# sourceMappingURL=stub-experience-tailor.d.ts.map