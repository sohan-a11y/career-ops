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

import { readFileSync, existsSync } from 'fs';
import * as yaml from 'js-yaml';
import type { ImmutableProfile, EmploymentRecord } from '../types/immutable-profile.js';

/**
 * Derive a URL-safe, stable slug from a company name. Deliberately
 * self-contained here (not imported from discover-ats.mjs) so the synthesis
 * package has no relative-path dependency reaching outside its own tree —
 * mirrors deriveSlug()'s exact behavior in discover-ats.mjs, kept in sync by
 * the shared self-test fixtures in load-immutable-profile.test.ts.
 */
function deriveSlug(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── cv.md parsing (pure functions, exported for tests) ──────────────────

export interface ParsedExperienceEntry {
  readonly title: string;
  readonly company: string;
  readonly dates: string; // raw "start – end" text, not yet split
  /** Raw achievement bullets exactly as written in cv.md — the only source
   *  material IExperienceTailor is allowed to reframe from; it must never
   *  invent a bullet not present here. */
  readonly bullets: readonly string[];
}

/**
 * Extract the "## Experience" section's raw text (up to the next "## "
 * heading or end of file). Returns '' if no such section exists.
 */
export function extractSection(markdown: string, headingPattern: RegExp): string {
  const lines = markdown.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingPattern.test(lines[i] ?? '')) { start = i + 1; break; }
  }
  if (start === -1) return '';

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] ?? '')) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

/**
 * Parse "## Experience" entries: `### Title` → `**Company** — ...` →
 * `*dates*` (in that order, blank lines tolerated between them).
 */
export function parseExperienceEntries(experienceSection: string): ParsedExperienceEntry[] {
  const lines = experienceSection.split(/\r?\n/);
  const entries: ParsedExperienceEntry[] = [];

  let pendingTitle: string | null = null;
  let pendingCompany: string | null = null;
  let pendingDates: string | null = null;
  let pendingBullets: string[] = [];
  // True once a dates line has been seen for the entry under construction —
  // only from this point on do "- " lines belong to THIS entry's bullets
  // rather than to unrelated leading list content.
  let collectingBullets = false;

  const flush = (): void => {
    if (pendingTitle && pendingCompany && pendingDates !== null) {
      entries.push({ title: pendingTitle, company: pendingCompany, dates: pendingDates, bullets: pendingBullets });
    }
    pendingTitle = null;
    pendingCompany = null;
    pendingDates = null;
    pendingBullets = [];
    collectingBullets = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const titleMatch = line.match(/^###\s+(.+)$/);
    if (titleMatch) {
      flush(); // a new ### heading always starts a fresh entry
      pendingTitle = titleMatch[1]?.trim() ?? null;
      continue;
    }

    // "**Company Name** — anything" or "**Company Name** (anything)"
    const companyMatch = line.match(/^\*\*([^*]+)\*\*/);
    if (companyMatch && pendingTitle && !pendingCompany) {
      pendingCompany = companyMatch[1]?.trim() ?? null;
      continue;
    }

    // "*start – end*" or "*start - end*" (em-dash, en-dash, or hyphen)
    const dateMatch = line.match(/^\*([^*]+)\*/);
    if (dateMatch && pendingTitle && pendingCompany && pendingDates === null) {
      pendingDates = dateMatch[1]?.trim() ?? '';
      collectingBullets = true;
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch?.[1] && collectingBullets) {
      pendingBullets.push(bulletMatch[1].trim());
    }
  }
  flush();

  return entries;
}

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
export function splitDateRange(raw: string): { startDate: string; endDate: string } {
  const withoutParenthetical = raw.replace(/\([^)]*\)\s*$/, '').trim();

  // Try separators in order of how safely they can be matched without
  // surrounding whitespace, falling through only when the previous attempt
  // didn't actually split anything (still just one part).
  const separators = [
    /\s+to\s+/i,     // "Jan 2020 to Present"
    /\s*[–—]\s*/,    // em/en-dash — safe even tight against the text
    /\s+-\s+/,       // plain hyphen — ONLY with required surrounding space
  ];

  let parts: string[] = [withoutParenthetical];
  for (const sep of separators) {
    const attempt = withoutParenthetical.split(sep);
    if (attempt.length >= 2) { parts = attempt; break; }
  }

  const startDate = (parts[0] ?? '').trim();
  const endRaw = (parts[1] ?? '').trim();
  const endDate = /^(present|current|now)$/i.test(endRaw) ? 'present' : endRaw;
  return { startDate, endDate };
}

/**
 * Assign stable, derived companyIds to parsed experience entries (slug +
 * index, so two roles at the same company never collide). Both
 * buildEmploymentHistory and extractRawBulletsByCompanyId call this SAME
 * function so their companyIds can never diverge from each other — the
 * tailor stage's bullets must key against exactly the same IDs the
 * immutable profile uses, or the merge stage's join silently drops them.
 */
export function assignCompanyIds(entries: ParsedExperienceEntry[]): Array<ParsedExperienceEntry & { companyId: string }> {
  const slugCounts = new Map<string, number>();
  return entries.map((entry) => {
    const baseSlug = deriveSlug(entry.company) || 'company';
    const count = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, count + 1);
    const companyId = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
    return { ...entry, companyId };
  });
}

/**
 * Convert parsed experience entries into EmploymentRecords with stable,
 * derived companyIds (slug + index, so two roles at the same company never
 * collide).
 */
export function buildEmploymentHistory(entries: ParsedExperienceEntry[]): EmploymentRecord[] {
  return assignCompanyIds(entries).map(({ companyId, company, dates }) => {
    const { startDate, endDate } = splitDateRange(dates);
    return { companyId, companyName: company, startDate, endDate };
  });
}

/**
 * Map each companyId to its raw, as-written cv.md bullets — the only
 * material a real IExperienceTailor implementation may draw from. Uses the
 * exact same companyId assignment as buildEmploymentHistory (see
 * assignCompanyIds), so a real tailor's output always joins back onto the
 * immutable profile it was derived from.
 */
export function extractRawBulletsByCompanyId(entries: ParsedExperienceEntry[]): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const entry of assignCompanyIds(entries)) {
    map.set(entry.companyId, entry.bullets);
  }
  return map;
}

/**
 * Parse the "## Education & Certifications" section into two arrays:
 * education entries (kept as loosely-typed records — the schema is
 * intentionally open per ImmutableProfile.education) and certification
 * display strings.
 */
export function parseEducationAndCertifications(markdown: string): {
  education: unknown[];
  certifications: string[];
} {
  const section = extractSection(markdown, /^##\s+Education\s*(&|and)?\s*Certifications?\s*$/i);
  if (!section) return { education: [], certifications: [] };

  const lines = section.split(/\r?\n/);
  const education: unknown[] = [];
  const certifications: string[] = [];
  let inCertBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^\*\*Certifications:?\*\*/i.test(line)) { inCertBlock = true; continue; }

    if (inCertBlock) {
      const bulletMatch = line.match(/^[-*]\s+(.+)$/);
      if (bulletMatch?.[1]) certifications.push(bulletMatch[1].trim());
      continue;
    }

    // A bold degree/institution line: "**Degree** — Institution · years"
    const degreeMatch = line.match(/^\*\*([^*]+)\*\*\s*[—-]\s*(.+)$/);
    if (degreeMatch) {
      const rest = degreeMatch[2] ?? '';
      const [org, ...yearParts] = rest.split('·').map((s) => s.trim());
      education.push({
        degree: degreeMatch[1]?.trim() ?? '',
        institution: org ?? '',
        years: yearParts.join('·').trim() || undefined,
      });
    }
  }

  return { education, certifications };
}

// ── config/profile.yml parsing ────────────────────────────────────────

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
export function buildContactInfo(candidate: ProfileYamlCandidate | undefined): Record<string, string> {
  if (!candidate) return {};
  const fields: Array<[string, string | undefined]> = [
    ['name', candidate.full_name],
    ['email', candidate.email],
    ['phone', candidate.phone],
    ['location', candidate.location],
    ['linkedin', candidate.linkedin],
    ['portfolio', candidate.portfolio_url],
    ['github', candidate.github],
    ['twitter', candidate.twitter],
    ['wechat', candidate.wechat],
  ];
  const out: Record<string, string> = {};
  for (const [key, value] of fields) {
    if (value && value.trim()) out[key] = value.trim();
  }
  return out;
}

// ── Top-level loader ─────────────────────────────────────────────────

export interface LoadImmutableProfileOptions {
  readonly cvPath: string;
  readonly profileYamlPath: string;
}

export class ProfileLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileLoadError';
  }
}

/**
 * Load the real ImmutableProfile from disk. Throws ProfileLoadError if
 * either source file is missing or unreadable — a synthesis run must never
 * silently proceed with a half-loaded identity.
 */
export function loadImmutableProfile(opts: LoadImmutableProfileOptions): ImmutableProfile {
  if (!existsSync(opts.cvPath)) {
    throw new ProfileLoadError(`cv.md not found at ${opts.cvPath}`);
  }
  if (!existsSync(opts.profileYamlPath)) {
    throw new ProfileLoadError(`config/profile.yml not found at ${opts.profileYamlPath}`);
  }

  const cvMarkdown = readFileSync(opts.cvPath, 'utf-8');
  const profileRaw = readFileSync(opts.profileYamlPath, 'utf-8');

  let profileYaml: { candidate?: ProfileYamlCandidate };
  try {
    profileYaml = (yaml.load(profileRaw) as { candidate?: ProfileYamlCandidate }) ?? {};
  } catch (err) {
    throw new ProfileLoadError(`config/profile.yml is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }

  const experienceSection = extractSection(cvMarkdown, /^##\s+Experience\s*$/i);
  const experienceEntries = parseExperienceEntries(experienceSection);
  const employmentHistory = buildEmploymentHistory(experienceEntries);
  const { education, certifications } = parseEducationAndCertifications(cvMarkdown);
  const contactInfo = buildContactInfo(profileYaml.candidate);

  return Object.freeze({
    contactInfo: Object.freeze(contactInfo),
    certifications: Object.freeze(certifications),
    education: Object.freeze(education),
    employmentHistory: Object.freeze(employmentHistory),
  });
}
