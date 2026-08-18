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
import type { IDocumentCompiler, CompiledDocument } from '../interfaces/document-compiler.js';
import type { MergedPortfolio } from '../types/merged-output.js';
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
export declare function detectPageFormat(location: string): 'letter' | 'a4';
export declare class RealDocumentCompiler implements IDocumentCompiler {
    private readonly opts;
    constructor(opts: RealDocumentCompilerOptions);
    compile(portfolio: MergedPortfolio): Promise<CompiledDocument>;
    private runScript;
}
//# sourceMappingURL=real-document-compiler.d.ts.map