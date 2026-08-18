/**
 * Real IPortfolioSynthesizer — produces a tailored professional summary,
 * core competencies, and project selection via the headless AI bridge.
 *
 * The interface only takes a TargetMatrix, so this concrete implementation
 * reads the user's REAL cv.md Projects/Skills sections itself (constructor
 * takes careerOpsRoot) and hands that raw source material to the AI worker
 * as context — exactly mirroring modes/pdf.md Step 11 ("select top 3-4 most
 * relevant projects") and Step 13 ("build competency grid... prioritizing
 * existing/supportedByResume skills"). The worker is told explicitly to
 * select and reword from what's given, never invent — same "Keywords get
 * reformulated, never fabricated" rule as every other mode (AGENTS.md).
 *
 * tailoredProjects entries use the exact shape build-cv-html.mjs's
 * `projects[]` field expects ({name, badge?, tech?, description}) so
 * RealDocumentCompiler can pass them straight through with no extra mapping.
 */
import type { IPortfolioSynthesizer, SynthesizedPayload } from '../interfaces/portfolio-synthesizer.js';
import type { TargetMatrix } from '../types/target-matrix.js';
import { type HeadlessAiBridgeOptions } from './headless-ai-bridge.js';
export interface RealPortfolioSynthesizerOptions extends HeadlessAiBridgeOptions {
}
export declare class RealPortfolioSynthesizer implements IPortfolioSynthesizer {
    private readonly opts;
    constructor(opts: RealPortfolioSynthesizerOptions);
    synthesize(matrix: TargetMatrix): Promise<SynthesizedPayload>;
}
//# sourceMappingURL=real-portfolio-synthesizer.d.ts.map