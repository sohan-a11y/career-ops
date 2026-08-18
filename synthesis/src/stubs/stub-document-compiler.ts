/**
 * Stub IDocumentCompiler — serializes the merged portfolio to a
 * JSON buffer.
 * In production this would render HTML→PDF via Playwright or
 * compile LaTeX.
 */

import type { IDocumentCompiler, CompiledDocument } from '../interfaces/document-compiler.js';
import type { MergedPortfolio } from '../types/merged-output.js';

export class StubDocumentCompiler implements IDocumentCompiler {
  async compile(portfolio: MergedPortfolio): Promise<CompiledDocument> {
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
