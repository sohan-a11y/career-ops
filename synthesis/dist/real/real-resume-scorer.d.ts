/**
 * Real IResumeScorer — scores the COMPILED, tailored resume against its
 * target matrix via the headless AI bridge, using the SAME 5-dimension
 * rubric documented in modes/_shared.md's "Scoring System" (Match with CV,
 * North Star alignment, Comp, Cultural signals, Red flags → Global). This
 * is not a second, competing rubric — it's the one career-ops already
 * uses everywhere else, applied here to the tailored output instead of
 * raw cv.md.
 *
 * Output fields (score, finalDecision, hardStops, softGaps, topStrengths,
 * riskLevel, confidence, nextAction) mirror batch/batch-prompt.md's
 * Machine Summary schema field-for-field, so a score produced here reads
 * identically to one produced by the interactive `oferta` evaluation.
 */
import type { IResumeScorer } from '../interfaces/resume-scorer.js';
import type { MergedPortfolio } from '../types/merged-output.js';
import type { TargetMatrix } from '../types/target-matrix.js';
import type { ScoreResult } from '../types/score-result.js';
import { type HeadlessAiBridgeOptions } from './headless-ai-bridge.js';
export interface RealResumeScorerOptions extends HeadlessAiBridgeOptions {
}
export declare class RealResumeScorer implements IResumeScorer {
    private readonly opts;
    constructor(opts: RealResumeScorerOptions);
    score(portfolio: MergedPortfolio, matrix: TargetMatrix): Promise<ScoreResult>;
}
//# sourceMappingURL=real-resume-scorer.d.ts.map