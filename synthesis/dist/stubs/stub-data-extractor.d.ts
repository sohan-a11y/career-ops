/**
 * Stub IDataExtractor — returns hardcoded JD text.
 * In production this would use Playwright/Puppeteer to scrape a live URL.
 */
import type { IDataExtractor, ExtractedContent } from '../interfaces/data-extractor.js';
export declare class StubDataExtractor implements IDataExtractor {
    extract(source: string): Promise<ExtractedContent>;
}
//# sourceMappingURL=stub-data-extractor.d.ts.map