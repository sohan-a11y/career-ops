/**
 * Real IDataExtractor — wraps the existing, already-hardened
 * browser-extract.mjs (headless Playwright JD reader) rather than
 * reimplementing scraping. Same script career-ops's own scan/pipeline modes
 * use when CAREER_OPS scan.extractor is set to "cli" — this is not a second,
 * competing extraction path.
 */
import type { IDataExtractor, ExtractedContent } from '../interfaces/data-extractor.js';
export interface RealDataExtractorOptions {
    /** Absolute path to the career-ops project root (where browser-extract.mjs lives). */
    readonly careerOpsRoot: string;
    /** Timeout in ms for the extraction subprocess. Default: 30000. */
    readonly timeoutMs?: number;
}
export declare class RealDataExtractor implements IDataExtractor {
    private readonly scriptPath;
    private readonly timeoutMs;
    constructor(opts: RealDataExtractorOptions);
    extract(source: string): Promise<ExtractedContent>;
}
//# sourceMappingURL=real-data-extractor.d.ts.map