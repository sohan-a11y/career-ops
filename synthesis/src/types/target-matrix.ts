/**
 * Target Requirements Matrix
 *
 * Extracted from a job description by the ITargetAnalyzer service.
 * This is the shared input contract that both the IPortfolioSynthesizer
 * and IExperienceTailor consume to produce tailored output.
 */

export interface TargetMatrix {
  /** The role title as stated in the job description. */
  readonly roleTitle: string;

  /** Company name from the posting. */
  readonly companyName: string;

  /**
   * Required technical and domain skills extracted from the JD.
   * Order reflects emphasis (most-mentioned or most-prominent first).
   */
  readonly requiredSkills: readonly string[];

  /**
   * Nice-to-have skills — mentioned but not gated on. */
  readonly preferredSkills: readonly string[];

  /**
   * Key responsibility themes (e.g., "lead a team of 5", "design APIs",
   * "reduce latency").  Used by the experience tailor to select and
   * reframe achievement bullets.
   */
  readonly responsibilityThemes: readonly string[];

  /**
   * Industry or domain context (e.g., "fintech", "healthcare AI").
   * Guides project selection and summary tone.
   */
  readonly industryContext: readonly string[];

  /**
   * Seniority signal extracted from the JD (e.g., "senior", "staff",
   * "lead", "principal").  Empty string when ambiguous.
   */
  readonly senioritySignal: string;

  /**
   * Job location as stated in the JD (e.g., "Remote (US)", "London, UK",
   * "San Francisco, CA", "Bengaluru, India"). Empty string when the JD
   * doesn't state one. Drives page-format selection downstream (US/Canada
   * → letter, rest of world → a4 — see modes/pdf.md's own rule).
   */
  readonly location: string;

  /**
   * Raw source text of the job description.  Carried for provenance —
   * the orchestrator never inspects it, but the document compiler may
   * embed a hash for traceability.
   */
  readonly rawSource: string;
}
