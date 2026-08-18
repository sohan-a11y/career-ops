/**
 * Stub IDocumentCompiler — serializes the merged portfolio to a
 * JSON buffer.
 * In production this would render HTML→PDF via Playwright or
 * compile LaTeX.
 */
export class StubDocumentCompiler {
    async compile(portfolio) {
        await delay(60);
        const json = JSON.stringify(portfolio, null, 2);
        const buffer = Buffer.from(json, 'utf-8');
        return {
            buffer,
            mimeType: 'application/json',
            filename: 'portfolio-synthesis-output.json',
            sizeBytes: buffer.byteLength,
        };
    }
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=stub-document-compiler.js.map