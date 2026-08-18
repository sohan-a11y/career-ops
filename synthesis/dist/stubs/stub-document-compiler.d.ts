/**
 * Stub IDocumentCompiler — serializes the merged portfolio to a
 * JSON buffer.
 * In production this would render HTML→PDF via Playwright or
 * compile LaTeX.
 */
import type { IDocumentCompiler, CompiledDocument } from '../interfaces/document-compiler.js';
import type { MergedPortfolio } from '../types/merged-output.js';
export declare class StubDocumentCompiler implements IDocumentCompiler {
    compile(portfolio: MergedPortfolio): Promise<CompiledDocument>;
}
//# sourceMappingURL=stub-document-compiler.d.ts.map