/**
 * Phase 1 — Mutable Payload
 *
 * Dynamic data synthesized per target environment.  Every field in this
 * structure is regenerated for each job application — nothing is cached
 * across targets.  The payload is produced by the IPortfolioSynthesizer
 * and IExperienceTailor services and merged with the ImmutableProfile by
 * the orchestrator's deterministic merge algorithm.
 */
export interface MutableEmploymentData {
    /**
     * Job title reframed to align with the target role's vocabulary.
     * Example: "Backend Developer" → "Platform Engineer" when the target
     * JD uses platform-engineering terminology.
     */
    readonly tailoredTitle: string;
    /**
     * Achievement bullets rewritten to foreground skills and metrics that
     * match the target's requirements matrix.  Order is intentional —
     * strongest-match bullets first.
     */
    readonly highlights: readonly string[];
}
export interface MutablePayload {
    /**
     * Two-to-four sentence professional summary synthesized from the
     * target requirements matrix and the user's profile.
     */
    readonly professionalSummary: string;
    /**
     * Ordered list of competency keywords selected to maximise ATS
     * keyword overlap with the target JD while remaining truthful to
     * the user's actual skill set.
     */
    readonly coreCompetencies: readonly string[];
    /**
     * Per-company tailored employment data, keyed by companyId.
     * The orchestrator joins this map against ImmutableProfile.employmentHistory
     * by companyId to produce merged employment entries.
     *
     * Using Map<string, …> rather than Record<string, …> because:
     *   1. The key space is dynamic and bounded by the profile.
     *   2. Map preserves insertion order (display order matters).
     *   3. Map.has() is an explicit membership test — no prototype chain.
     */
    readonly employmentDetails: ReadonlyMap<string, MutableEmploymentData>;
    /**
     * Portfolio projects selected and reframed for the target role.
     * Kept as `unknown[]` because project schema varies by user
     * (title, description, tech stack, link, metrics, …).
     */
    readonly tailoredProjects: readonly unknown[];
}
//# sourceMappingURL=mutable-payload.d.ts.map