/**
 * IDataExtractor
 *
 * Abstracts browser telemetry / DOM extraction.  Replaces hardcoded
 * Puppeteer/Playwright scraping scripts with a pluggable interface
 * so the orchestrator can resolve JD content from any source:
 * live URL, cached HTML, local file, or ATS API response.
 *
 * OUT OF SCOPE for this sprint: the actual extraction implementation.
 */
export interface ExtractedContent {
    /** The raw text content of the job description. */
    readonly text: string;
    /** The page title, if extractable. */
    readonly title: string;
    /** The resolved canonical URL (after redirects). */
    readonly resolvedUrl: string;
    /**
     * Structured metadata extracted from the page (JSON-LD, meta tags,
     * ATS-specific data attributes).  Shape varies by source.
     */
    readonly metadata: Readonly<Record<string, unknown>>;
    /** ISO-8601 timestamp of extraction. */
    readonly extractedAt: string;
}
export interface IDataExtractor {
    /**
     * Extract content from a source identifier (URL, file path, or
     * raw HTML string).
     *
     * @param source - The source to extract from.
     * @returns Extracted content with metadata.
     * @throws SynthesisError with stage = 'extract' on failure.
     */
    extract(source: string): Promise<ExtractedContent>;
}
//# sourceMappingURL=data-extractor.d.ts.map