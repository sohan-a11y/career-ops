/**
 * Score Result
 *
 * The output of scoring a compiled, tailored resume against its target
 * matrix. Deliberately mirrors the Machine Summary schema documented in
 * batch/batch-prompt.md (the career-ops-wide source of truth for this
 * vocabulary) — same field names, same enums — so a score produced here is
 * directly comparable to one produced by the interactive `oferta`/
 * `auto-pipeline` evaluation. This is not a second, competing scoring
 * rubric; it's the same one, applied to the compiled output instead of
 * raw cv.md.
 */
export type FinalDecision = 'Apply' | 'Consider' | 'Research first' | 'Skip';
export type RiskLevel = 'Low' | 'Medium' | 'High';
export type ConfidenceLevel = 'Low' | 'Medium' | 'High';
/**
 * The five scored dimensions from modes/_shared.md's Scoring System
 * (1-5 each; Red flags is represented as findings in ScoreResult.hardStops
 * instead of a numeric dimension, matching how the rubric itself treats it
 * as "negative adjustments" rather than a fifth 1-5 axis).
 */
export interface DimensionScores {
    /** Skills, experience, proof-points alignment against the JD. */
    readonly matchWithCv: number;
    /** How well the role fits the candidate's target archetypes. */
    readonly northStarAlignment: number;
    /** Salary vs. market (5 = top quartile, 1 = well below). */
    readonly comp: number;
    /** Company culture, growth, stability, remote policy. */
    readonly culturalSignals: number;
}
export interface ScoreResult {
    /** Global holistic score, 1-5 (no arithmetic formula — see modes/_shared.md). */
    readonly score: number;
    readonly dimensions: DimensionScores;
    /**
     * Score-interpretation-driven recommendation:
     *   4.5+     → Apply
     *   4.0-4.4  → Apply
     *   3.5-3.9  → Consider (apply only if a specific reason)
     *   below 3.5 → Skip (recommend against, per AGENTS.md Ethical Use)
     * The AI worker sets this directly rather than the orchestrator deriving
     * it mechanically, so a hard_stop can override an otherwise-decent score.
     */
    readonly finalDecision: FinalDecision;
    /** Blocking gaps or risks — a non-empty list here should pull finalDecision toward Skip regardless of the numeric score. */
    readonly hardStops: readonly string[];
    /** Non-blocking gaps worth knowing about but not disqualifying. */
    readonly softGaps: readonly string[];
    /** Strengths most relevant to this specific role. */
    readonly topStrengths: readonly string[];
    readonly riskLevel: RiskLevel;
    readonly confidence: ConfidenceLevel;
    /** One concrete next step — e.g. "Proceed to apply", "Skip — seniority mismatch". */
    readonly nextAction: string;
}
//# sourceMappingURL=score-result.d.ts.map