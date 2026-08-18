/**
 * Stub IPortfolioSynthesizer — generates a tailored summary,
 * competencies, and project selection.
 * In production this would use multi-agent LLM orchestration.
 */
import type { IPortfolioSynthesizer, SynthesizedPayload } from '../interfaces/portfolio-synthesizer.js';
import type { TargetMatrix } from '../types/target-matrix.js';
export declare class StubPortfolioSynthesizer implements IPortfolioSynthesizer {
    synthesize(matrix: TargetMatrix): Promise<SynthesizedPayload>;
}
//# sourceMappingURL=stub-portfolio-synthesizer.d.ts.map