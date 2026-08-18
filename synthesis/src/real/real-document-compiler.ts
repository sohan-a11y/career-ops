/**
 * Real IDocumentCompiler — transforms a MergedPortfolio into the exact JSON
 * Input Schema documented in modes/pdf.md, then reuses the existing,
 * already-hardened rendering chain rather than reimplementing HTML/PDF
 * generation:
 *
 *   MergedPortfolio → render payload (this file)
 *       → build-cv-html.mjs   (owns every tag/CSS class/escaping)
 *       → verify-cv-facts.mjs (HARD GATE — same one modes/pdf.md Step 19 runs;
 *                               a merge that somehow let a fabricated claim
 *                               through is caught here, not silently shipped)
 *       → generate-pdf.mjs    (Playwright HTML → PDF)
 *
 * This is not a fourth CV-rendering implementation — it is the SAME three
 * scripts every interactive `/career-ops pdf` run already calls.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import type { IDocumentCompiler, CompiledDocument } from '../interfaces/document-compiler.js';
import type { MergedPortfolio, MergedEmploymentEntry } from '../types/merged-output.js';
import { SynthesisError } from '../errors/synthesis-errors.js';
// cv-templates.mjs is career-ops's single source of truth for "which
// template file, and is it usable?" — reused here rather than hardcoding
// cv-template.html, exactly as modes/pdf.md's "Selecting the template"
// step instructs every interactive run to do.
// @ts-expect-error — plain .mjs sibling script, no type declarations.
import { resolveTemplate } from '../../../cv-templates.mjs';

export interface RealDocumentCompilerOptions {
  readonly careerOpsRoot: string;
  /**
   * 'letter' (US/Canada) or 'a4' (rest of world). Explicit override — when
   * omitted, auto-detected per-compile from MergedPortfolio.targetLocation
   * (see detectPageFormat), matching modes/pdf.md's own rule. Missing
   * location data still defaults to 'letter'.
   */
  readonly pageFormat?: 'letter' | 'a4';
  /**
   * Kebab-case template name (e.g. "modern"), resolved via cv-templates.mjs.
   * Omit to use config/profile.yml's cv.template default, or the base
   * cv-template.html if that's also unset — same resolution order as
   * `/career-ops pdf`'s "Selecting the template" step.
   */
  readonly template?: string;
  /** Output PDF filename (without directory). Default: derived from candidate name + timestamp. */
  readonly outputFilename?: string;
  /**
   * Report number (e.g. "018") to link this PDF to in data/pdf-index.tsv,
   * matching every other PDF-generating path in career-ops (modes/pdf.md
   * Step 21, batch-runner.sh). Omit for a one-off PDF with no tracker
   * entry — generate-pdf.mjs skips the manifest write when absent.
   */
  readonly reportNumber?: string;
  readonly timeoutMs?: number;
}

interface RenderCandidateLink {
  url: string;
  display: string;
}

interface RenderPayload {
  lang: string;
  page_format: 'letter' | 'a4';
  candidate: {
    name: string;
    phone?: string | undefined;
    email?: string | undefined;
    linkedin?: RenderCandidateLink | undefined;
    github?: RenderCandidateLink | undefined;
    portfolio?: RenderCandidateLink | undefined;
    location?: string | undefined;
  };
  summary: string;
  competencies: string[];
  experience: Array<{ company: string; role: string; dates: string; bullets: string[] }>;
  projects: Array<{ name: string; badge?: string | undefined; tech?: string | undefined; description: string }>;
  education: Array<{ title: string; org: string; year: string }>;
  certifications: Array<{ title: string; org: string; year: string }>;
}

function toLink(value: string | undefined): RenderCandidateLink | undefined {
  if (!value || !value.trim()) return undefined;
  const trimmed = value.trim();
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return { url, display: trimmed.replace(/^https?:\/\//i, '') };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatDates(entry: MergedEmploymentEntry): string {
  const end = entry.endDate === 'present' ? 'Present' : entry.endDate;
  return `${entry.startDate} – ${end}`;
}

/** "Google Associate Cloud Engineer (2024)" → {title: "...", year: "2024"} */
function splitCertification(raw: string): { title: string; org: string; year: string } {
  const match = raw.match(/^(.+?)\s*\((\d{4})\)\s*$/);
  if (match) return { title: match[1] ?? raw, org: '', year: match[2] ?? '' };
  return { title: raw, org: '', year: '' };
}

function toEducationEntry(raw: unknown): { title: string; org: string; year: string } {
  const e = raw as { degree?: string; institution?: string; years?: string };
  return { title: e?.degree ?? '', org: e?.institution ?? '', year: e?.years ?? '' };
}

function toProjectEntry(raw: unknown): { name: string; badge?: string | undefined; tech?: string | undefined; description: string } {
  const p = raw as { name?: string; badge?: string; tech?: string; description?: string };
  return { name: p?.name ?? '', badge: p?.badge, tech: p?.tech, description: p?.description ?? '' };
}

// US state/territory two-letter codes — used to recognize "City, XX" style
// locations. Not exhaustive of every possible location phrasing (this is a
// paper-size heuristic, not a geocoding service — same "good enough,
// substring-based" philosophy as portals.yml's location_filter), but covers
// the common case a JD's location field actually uses.
const US_STATE_CODES = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia',
  'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj',
  'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt',
  'va', 'wa', 'wv', 'wi', 'wy', 'dc',
]);

// \bus\b is safe here specifically because this function's input is a JD's
// short, structured location field ("Remote (US)", "US-based") — not free
// prose, where a bare "us" would usually be the pronoun, not the country.
const US_CANADA_COUNTRY_PATTERNS = [
  /\bunited states\b/, /\bu\.s\.a?\.?\b/, /\busa\b/, /\bus\b/, /\bamerica\b/,
  /\bcanada\b/, /\bontario\b/, /\bquebec\b/, /\bbritish columbia\b/, /\balberta\b/,
];

/**
 * Detect whether a JD-stated location implies US/Canada (→ letter) or
 * elsewhere (→ a4), mirroring modes/pdf.md's own rule ("Detect company
 * location → paper format: US/Canada → letter, Rest of world → a4").
 *
 * Missing/empty location data defaults to 'letter' (the pre-existing
 * default before this function existed) rather than guessing — same
 * "don't penalize missing data" discipline every filter in portals.yml
 * already follows.
 */
export function detectPageFormat(location: string): 'letter' | 'a4' {
  if (!location || !location.trim()) return 'letter';
  const text = location.toLowerCase();

  if (US_CANADA_COUNTRY_PATTERNS.some((p) => p.test(text))) return 'letter';

  // "City, XX" or "City, XX, ..." — a two-letter state/province code as its
  // own comma-delimited segment, not a substring inside a longer word.
  const segments = text.split(',').map((s) => s.trim());
  if (segments.some((seg) => US_STATE_CODES.has(seg))) return 'letter';

  return 'a4';
}

function buildRenderPayload(portfolio: MergedPortfolio, lang: string, pageFormat: 'letter' | 'a4'): RenderPayload {
  return {
    lang,
    page_format: pageFormat,
    candidate: {
      name: portfolio.contactInfo.name ?? '',
      phone: portfolio.contactInfo.phone,
      email: portfolio.contactInfo.email,
      linkedin: toLink(portfolio.contactInfo.linkedin),
      github: toLink(portfolio.contactInfo.github),
      portfolio: toLink(portfolio.contactInfo.portfolio),
      location: portfolio.contactInfo.location,
    },
    summary: portfolio.professionalSummary,
    competencies: [...portfolio.coreCompetencies],
    experience: portfolio.employment.map((e) => ({
      company: e.companyName,
      role: e.tailoredTitle || '(role not tailored — see mergeStats.unmatchedEntries)',
      dates: formatDates(e),
      bullets: [...e.highlights],
    })),
    projects: portfolio.tailoredProjects.map(toProjectEntry),
    education: portfolio.education.map(toEducationEntry),
    certifications: portfolio.certifications.map(splitCertification),
  };
}

function readOutputLanguage(careerOpsRoot: string): string {
  const profilePath = join(careerOpsRoot, 'config', 'profile.yml');
  if (!existsSync(profilePath)) return 'en';
  try {
    const parsed = yaml.load(readFileSync(profilePath, 'utf-8')) as { language?: { output?: string } } | undefined;
    return parsed?.language?.output ?? 'en';
  } catch {
    return 'en';
  }
}

export class RealDocumentCompiler implements IDocumentCompiler {
  constructor(private readonly opts: RealDocumentCompilerOptions) {}

  async compile(portfolio: MergedPortfolio): Promise<CompiledDocument> {
    const root = this.opts.careerOpsRoot;
    const timeoutMs = this.opts.timeoutMs ?? 60_000;
    // Explicit constructor option always wins; otherwise auto-detect from
    // the JD's stated location (matches modes/pdf.md's own rule).
    const pageFormat = this.opts.pageFormat ?? detectPageFormat(portfolio.targetLocation);
    const lang = readOutputLanguage(root);

    const payload = buildRenderPayload(portfolio, lang, pageFormat);

    const scratchDir = mkdtempSync(join(tmpdir(), 'career-ops-synthesis-compile-'));
    const payloadPath = join(scratchDir, 'render-payload.json');
    writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

    // Named after the TARGET company (who this CV is FOR), never the
    // candidate's own past employer — see MergedPortfolio.targetCompany's
    // doc comment for why employment[0] is the wrong source here.
    const candidateSlug = slugify(payload.candidate.name || 'candidate') || 'candidate';
    const companySlug = slugify(portfolio.targetCompany || 'target') || 'target';
    const baseFilename = this.opts.outputFilename ?? `cv-${candidateSlug}-${companySlug}`;

    const outputDir = join(root, 'output');
    mkdirSync(outputDir, { recursive: true });
    const htmlPath = join(outputDir, `${baseFilename}.html`);
    const pdfPath = join(outputDir, `${baseFilename}.pdf`);

    // Same resolution order as modes/pdf.md's "Selecting the template":
    // explicit name → config/profile.yml's cv.template → base
    // cv-template.html. fallback:true means a named-but-missing template
    // degrades to the base rather than hard-failing the whole compile.
    let templatePath: string;
    try {
      templatePath = resolveTemplate('cv', this.opts.template, {
        dir: join(root, 'templates'),
        profilePath: join(root, 'config', 'profile.yml'),
        fallback: true,
      }) as string;
    } catch (err) {
      throw new SynthesisError('compile', `Template resolution failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }

    // ── 1. build-cv-html.mjs — owns every tag/CSS class/escaping ────────
    this.runScript('compile', 'build-cv-html.mjs', [payloadPath, htmlPath, templatePath], timeoutMs);

    // ── 2. verify-cv-facts.mjs — HARD GATE before PDF rendering ─────────
    // Same gate modes/pdf.md Step 19 runs. A merge bug that somehow let a
    // fabricated claim through the immutable/mutable split is caught HERE,
    // not silently shipped as a PDF.
    const factCheck = this.runScript('compile', 'verify-cv-facts.mjs', [htmlPath], timeoutMs, { allowNonZero: true });
    if (factCheck.status !== 0) {
      throw new SynthesisError('compile', 'Fact-verification gate failed — the generated CV contains claims not traceable to cv.md/article-digest.md. Refusing to render a PDF.', {
        context: { stdout: factCheck.stdout.slice(-1500), htmlPath },
      });
    }

    // ── 3. generate-pdf.mjs — Playwright HTML → PDF ──────────────────────
    const pdfArgs = [htmlPath, pdfPath, `--format=${pageFormat}`];
    if (this.opts.reportNumber) pdfArgs.push(`--report=${this.opts.reportNumber}`);
    this.runScript('compile', 'generate-pdf.mjs', pdfArgs, timeoutMs);

    if (!existsSync(pdfPath)) {
      throw new SynthesisError('compile', `generate-pdf.mjs reported success but no PDF was found at ${pdfPath}`);
    }

    const buffer = readFileSync(pdfPath);
    return Object.freeze({
      buffer,
      mimeType: 'application/pdf',
      filename: `${baseFilename}.pdf`,
      sizeBytes: buffer.byteLength,
    });
  }

  private runScript(
    stage: 'compile',
    script: string,
    args: string[],
    timeoutMs: number,
    opts: { allowNonZero?: boolean } = {},
  ): { status: number | null; stdout: string; stderr: string } {
    const scriptPath = join(this.opts.careerOpsRoot, script);
    if (!existsSync(scriptPath)) {
      throw new SynthesisError(stage, `${script} not found at ${scriptPath} — is careerOpsRoot correct?`);
    }

    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      cwd: this.opts.careerOpsRoot,
    });

    if (result.error) {
      throw new SynthesisError(stage, `Failed to run ${script}: ${result.error.message}`, { cause: result.error });
    }

    if (result.status !== 0 && !opts.allowNonZero) {
      throw new SynthesisError(stage, `${script} exited ${result.status}`, {
        context: { stderr: result.stderr.slice(-1500), stdout: result.stdout.slice(-1500) },
      });
    }

    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }
}
