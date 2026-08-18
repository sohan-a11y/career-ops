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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { SynthesisError } from '../errors/synthesis-errors.js';
import { invokeHeadlessAi, buildSystemPrompt } from './headless-ai-bridge.js';
const STAGE_INSTRUCTIONS = `## Synthesis Pipeline — Score Stage

You are performing the SCORE stage of the Dynamic Portfolio Synthesis Pipeline. You are given the COMPILED, TAILORED resume content (not raw cv.md) and the target requirements matrix it was tailored for. Score it using the SAME 5-dimension rubric defined in the "Scoring System" section above — you are scoring the specific tailored materials that would actually be submitted for this role, not the candidate's unfiltered background.

**Dimensions (1-5 each):**
- Match with CV — skills, experience, proof-points alignment against the JD
- North Star alignment — how well the role fits the candidate's target archetypes
- Comp — salary vs. market (5 = top quartile, 1 = well below; use the target matrix + tailored content, no external research — this stage has no research budget)
- Cultural signals — company culture, growth, stability, remote policy, from whatever evidence is present in the target matrix

**Global score** is a holistic judgment integrating all dimensions — no arithmetic formula. Apply the standard interpretation: 4.5+ → Apply; 4.0-4.4 → Apply; 3.5-3.9 → Consider (only with a specific reason); below 3.5 → Skip. A hard_stop should pull finalDecision toward Skip regardless of the numeric score — a high score with a genuine blocker is still not an "Apply."

Respond with ONLY a single fenced \`\`\`json code block (nothing before or after it) containing an object with EXACTLY this shape:

\`\`\`json
{
  "score": 0.0,
  "dimensions": {
    "matchWithCv": 0.0,
    "northStarAlignment": 0.0,
    "comp": 0.0,
    "culturalSignals": 0.0
  },
  "finalDecision": "Apply | Consider | Research first | Skip",
  "hardStops": ["string", "..."],
  "softGaps": ["string", "..."],
  "topStrengths": ["string", "..."],
  "riskLevel": "Low | Medium | High",
  "confidence": "Low | Medium | High",
  "nextAction": "string — one concrete next step"
}
\`\`\`

Base every field strictly on the tailored content and target matrix given — never invent a strength or soften a hard stop to make the match look better than it is.`;
const VALID_FINAL_DECISIONS = ['Apply', 'Consider', 'Research first', 'Skip'];
const VALID_RISK_LEVELS = ['Low', 'Medium', 'High'];
const VALID_CONFIDENCE_LEVELS = ['Low', 'Medium', 'High'];
function coerceEnum(value, valid, fallback) {
    return value && valid.includes(value) ? value : fallback;
}
/**
 * Read config/profile.yml's culture_screen block, if present, so the
 * scoring prompt can apply the same structural capping rule modes/_shared.md
 * documents (require criteria contradicted → cap Cultural signals at 2/5)
 * instead of scoring that dimension blind.
 */
function readCultureScreen(careerOpsRoot) {
    const profilePath = join(careerOpsRoot, 'config', 'profile.yml');
    if (!existsSync(profilePath))
        return null;
    try {
        const parsed = yaml.load(readFileSync(profilePath, 'utf-8'));
        return parsed?.culture_screen ?? null;
    }
    catch {
        return null;
    }
}
export class RealResumeScorer {
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    async score(portfolio, matrix) {
        const cultureScreen = readCultureScreen(this.opts.careerOpsRoot);
        const systemPrompt = buildSystemPrompt(this.opts.careerOpsRoot, STAGE_INSTRUCTIONS);
        const userPrompt = [
            `Target requirements matrix:\n${JSON.stringify(matrix, null, 2)}`,
            `Candidate's culture_screen preferences (config/profile.yml, null if unset):\n${JSON.stringify(cultureScreen, null, 2)}`,
            `Compiled, tailored resume content to score (this is what would actually be submitted):\n${JSON.stringify({
                professionalSummary: portfolio.professionalSummary,
                coreCompetencies: portfolio.coreCompetencies,
                employment: portfolio.employment,
                tailoredProjects: portfolio.tailoredProjects,
                certifications: portfolio.certifications,
                education: portfolio.education,
                mergeStats: portfolio.mergeStats,
            }, null, 2)}`,
        ].join('\n\n---\n\n');
        const raw = invokeHeadlessAi('score', systemPrompt, userPrompt, this.opts);
        if (!raw || typeof raw !== 'object') {
            throw new SynthesisError('score', 'Headless AI worker returned a non-object response for the Score stage');
        }
        const score = typeof raw.score === 'number' ? raw.score : 0;
        if (score < 0 || score > 5) {
            throw new SynthesisError('score', `Headless AI worker returned an out-of-range score: ${score} (expected 0-5)`);
        }
        return Object.freeze({
            score,
            dimensions: Object.freeze({
                matchWithCv: raw.dimensions?.matchWithCv ?? 0,
                northStarAlignment: raw.dimensions?.northStarAlignment ?? 0,
                comp: raw.dimensions?.comp ?? 0,
                culturalSignals: raw.dimensions?.culturalSignals ?? 0,
            }),
            finalDecision: coerceEnum(raw.finalDecision, VALID_FINAL_DECISIONS, 'Research first'),
            hardStops: Object.freeze([...(raw.hardStops ?? [])]),
            softGaps: Object.freeze([...(raw.softGaps ?? [])]),
            topStrengths: Object.freeze([...(raw.topStrengths ?? [])]),
            riskLevel: coerceEnum(raw.riskLevel, VALID_RISK_LEVELS, 'Medium'),
            confidence: coerceEnum(raw.confidence, VALID_CONFIDENCE_LEVELS, 'Low'),
            nextAction: raw.nextAction ?? 'Review manually — the scorer did not return a next action',
        });
    }
}
//# sourceMappingURL=real-resume-scorer.js.map