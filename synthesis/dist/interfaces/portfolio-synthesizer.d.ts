/**
 * IPortfolioSynthesizer
 *
 * Asynchronous data resolution service that accepts a target requirements
 * matrix and proposes matching projects from the user's portfolio.
 * Also responsible for generating the professional summary and selecting
 * core competencies.
 *
 * Concrete implementations may use multi-agent swarms (CrewAI, LangGraph),
 * embedding similarity, or manual scoring — the orchestrator is agnostic.
 *
 * OUT OF SCOPE for this sprint: the actual synthesis algorithm.
 */
import type { TargetMatrix } from '../types/target-matrix.js';
/**
 * The partial payload produced by the synthesizer.
 * Employment details are handled separately by IExperienceTailor.
 */
export interface SynthesizedPayload {
    readonly professionalSummary: string;
    readonly coreCompetencies: readonly string[];
    readonly tailoredProjects: readonly unknown[];
}
export interface IPortfolioSynthesizer {
    /**
     * Given a target matrix, produce a tailored professional summary,
     * competency list, and project selection.
     *
     * @param matrix - The requirements matrix from ITargetAnalyzer.
     * @returns Partial payload (summary, competencies, projects).
     * @throws SynthesisError with stage = 'synthesize' on failure.
     */
    synthesize(matrix: TargetMatrix): Promise<SynthesizedPayload>;
}
//# sourceMappingURL=portfolio-synthesizer.d.ts.map