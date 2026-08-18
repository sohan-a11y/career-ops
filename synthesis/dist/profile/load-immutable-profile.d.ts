/**
 * Real ImmutableProfile loader.
 *
 * Parses the user's ACTUAL cv.md + config/profile.yml into an ImmutableProfile
 * — no fake/stub data. This is the "single source of truth" bridge: the same
 * cv.md the rest of career-ops already treats as canonical (see AGENTS.md →
 * "CV Source of Truth") is the ONLY input here. Nothing is invented; a field
 * this parser can't find is simply absent (an empty array/object), never
 * guessed.
 *
 * cv.md convention this parser expects (the same structure every mode in
 * career-ops already assumes — see modes/pdf.md's "ATS Rules"):
 *
 *   ## Experience
 *   ### {Job Title}
 *   **{Company Name}** — {location or client note}
 *   *{start date} – {end date}*
 *
 *   - bullet
 *   - bullet
 *
 *   ## Education & Certifications
 *   **{Degree}** — {Institution} · {years}
 *   **Certifications:**
 *   - {cert} ({year})
 *
 * A cv.md that deviates from this (no "## Experience" heading, a company line
 * that isn't bold, etc.) yields a partial or empty employmentHistory rather
 * than throwing — callers should treat zero parsed entries as a signal to
 * check the file, not as "the candidate has no experience".
 */
import type { ImmutableProfile, EmploymentRecord } from '../types/immutable-profile.js';
export interface ParsedExperienceEntry {
    readonly title: string;
    readonly company: string;
    readonly dates: string;
    /** Raw achievement bullets exactly as written in cv.md — the only source
     *  material IExperienceTailor is allowed to reframe from; it must never
     *  invent a bullet not present here. */
    readonly bullets: readonly string[];
}
/**
 * Extract the "## Experience" section's raw text (up to the next "## "
 * heading or end of file). Returns '' if no such section exists.
 */
export declare function extractSection(markdown: string, headingPattern: RegExp): string;
/**
 * Parse "## Experience" entries: `### Title` → `**Company** — ...` →
 * `*dates*` (in that order, blank lines tolerated between them).
 */
export declare function parseExperienceEntries(experienceSection: string): ParsedExperienceEntry[];
/**
 * Split a raw date-range string into {startDate, endDate}. Recognizes
 * "to", an em/en-dash (–—, safe to match with no surrounding whitespace —
 * dashes essentially never appear inside a date token itself), and a plain
 * hyphen as separators; "Present" / "Current" / "Now" (case-insensitive)
 * normalizes to the literal "present". A parenthetical suffix (e.g.
 * "(also: ... )") is stripped before splitting.
 *
 * The plain hyphen ONLY splits when whitespace surrounds it — an ISO-ish
 * date like "2019-06" must never be torn apart at its internal hyphen the
 * way an unguarded `-` alternative would.
 */
export declare function splitDateRange(raw: string): {
    startDate: string;
    endDate: string;
};
/**
 * Assign stable, derived companyIds to parsed experience entries (slug +
 * index, so two roles at the same company never collide). Both
 * buildEmploymentHistory and extractRawBulletsByCompanyId call this SAME
 * function so their companyIds can never diverge from each other — the
 * tailor stage's bullets must key against exactly the same IDs the
 * immutable profile uses, or the merge stage's join silently drops them.
 */
export declare function assignCompanyIds(entries: ParsedExperienceEntry[]): Array<ParsedExperienceEntry & {
    companyId: string;
}>;
/**
 * Convert parsed experience entries into EmploymentRecords with stable,
 * derived companyIds (slug + index, so two roles at the same company never
 * collide).
 */
export declare function buildEmploymentHistory(entries: ParsedExperienceEntry[]): EmploymentRecord[];
/**
 * Map each companyId to its raw, as-written cv.md bullets — the only
 * material a real IExperienceTailor implementation may draw from. Uses the
 * exact same companyId assignment as buildEmploymentHistory (see
 * assignCompanyIds), so a real tailor's output always joins back onto the
 * immutable profile it was derived from.
 */
export declare function extractRawBulletsByCompanyId(entries: ParsedExperienceEntry[]): ReadonlyMap<string, readonly string[]>;
/**
 * Parse the "## Education & Certifications" section into two arrays:
 * education entries (kept as loosely-typed records — the schema is
 * intentionally open per ImmutableProfile.education) and certification
 * display strings.
 */
export declare function parseEducationAndCertifications(markdown: string): {
    education: unknown[];
    certifications: string[];
};
interface ProfileYamlCandidate {
    full_name?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    portfolio_url?: string;
    github?: string;
    twitter?: string;
    wechat?: string;
}
/**
 * Build the contactInfo record from config/profile.yml's `candidate` block.
 * Empty/absent fields are simply omitted from the record — never a fabricated
 * placeholder.
 */
export declare function buildContactInfo(candidate: ProfileYamlCandidate | undefined): Record<string, string>;
export interface LoadImmutableProfileOptions {
    readonly cvPath: string;
    readonly profileYamlPath: string;
}
export declare class ProfileLoadError extends Error {
    constructor(message: string);
}
/**
 * Load the real ImmutableProfile from disk. Throws ProfileLoadError if
 * either source file is missing or unreadable — a synthesis run must never
 * silently proceed with a half-loaded identity.
 */
export declare function loadImmutableProfile(opts: LoadImmutableProfileOptions): ImmutableProfile;
export {};
//# sourceMappingURL=load-immutable-profile.d.ts.map