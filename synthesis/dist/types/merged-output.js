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
export {};
//# sourceMappingURL=merged-output.js.map