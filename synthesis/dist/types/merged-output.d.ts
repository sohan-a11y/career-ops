/**
 * Merged Output
 *
 * The deterministic product of merging ImmutableProfile with MutablePayload.
 * Every immutable field (dates, company names, contact info, education,
 * certifications) passes through untouched.  Mutable fields (tailored title,
 * highlights, summary, competencies, projects) are populated from the payload.
 *
 * Employment entries that exist in the immutable profile but have no
 * corresponding key in the mutable payload's employmentDetails map receive
 * empty/default mutable fields — they are never dropped.
 */
export interface MergedEmploymentEntry {
    readonly companyId: string;
    readonly companyName: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly tailoredTitle: string;
    readonly highlights: readonly string[];
    /**
     * true when the mutable payload contained a matching companyId entry.
     * Downstream consumers can use this to flag incomplete tailoring
     * without having to re-run the match.
     */
    readonly matched: boolean;
}
export interface MergedPortfolio {
    readonly contactInfo: Readonly<Record<string, string>>;
    readonly certifications: readonly string[];
    readonly education: readonly unknown[];
    readonly professionalSummary: string;
    readonly coreCompetencies: readonly string[];
    readonly tailoredProjects: readonly unknown[];
    readonly employment: readonly MergedEmploymentEntry[];
    readonly targetCompany: string;
    readonly targetRole: string;
    /** From TargetMatrix.location — drives page-format auto-detection. */
    readonly targetLocation: string;
    readonly mergeStats: MergeStats;
}
export interface MergeStats {
    /** Total employment entries from the immutable profile. */
    readonly totalImmutableEntries: number;
    /** Entries that had a matching key in the mutable payload. */
    readonly matchedEntries: number;
    /** Entries with no mutable counterpart (carried with defaults). */
    readonly unmatchedEntries: number;
    /** Keys in the mutable payload that had no immutable counterpart. */
    readonly orphanedMutableKeys: readonly string[];
    /** ISO-8601 timestamp of the merge operation. */
    readonly mergedAt: string;
}
//# sourceMappingURL=merged-output.d.ts.map