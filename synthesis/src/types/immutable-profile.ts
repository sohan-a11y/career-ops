/**
 * Phase 1 — Immutable State
 *
 * Locked factual data derived from the user's cv.md, config/profile.yml,
 * and education/employment records.  These fields are NEVER mutated by the
 * synthesis pipeline.  Every value is resolved once during profile hydration
 * and carried forward verbatim into every compiled document.
 */

export interface EmploymentRecord {
  /** Stable internal identifier (slugified company + sequence). */
  readonly companyId: string;

  /** Display name exactly as it appears in the source CV. */
  readonly companyName: string;

  /** ISO-8601 date string (YYYY-MM-DD or YYYY-MM). */
  readonly startDate: string;

  /**
   * ISO-8601 date string, or the sentinel "present" for a current role.
   * The orchestrator treats "present" as semantically distinct from an
   * empty string — downstream compilers render it as "Present" / "Current".
   */
  readonly endDate: string;
}

export interface ImmutableProfile {
  /**
   * Key-value contact details (name, email, phone, location, linkedin, …).
   * Keys are lowercase identifiers; values are display strings.
   * The pipeline never interprets the keys — it passes them through to the
   * document compiler unchanged.
   */
  readonly contactInfo: Readonly<Record<string, string>>;

  /** Certification names in display order. */
  readonly certifications: readonly string[];

  /**
   * Education entries.  Kept as `unknown[]` because the schema is
   * user-defined (degree, institution, date, GPA, …) and varies across
   * markets.  The orchestrator never inspects these — it forwards them
   * as-is to the document compiler.
   */
  readonly education: readonly unknown[];

  /**
   * Chronological employment records.  The `companyId` field is the join
   * key used by the merge algorithm to attach mutable payload data
   * (tailored titles, bullet highlights) without touching dates or names.
   */
  readonly employmentHistory: readonly EmploymentRecord[];
}
