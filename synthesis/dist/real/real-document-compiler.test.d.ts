/**
 * Tests for RealDocumentCompiler — real filesystem I/O and real subprocess
 * calls to build-cv-html.mjs / verify-cv-facts.mjs / generate-pdf.mjs, but
 * NO AI calls (all three of those scripts are deterministic). Verifies the
 * exact bug this file was written to catch (filename must come from
 * targetCompany, never employment[0]) and that the fact-verification hard
 * gate genuinely rejects a fabricated claim rather than rendering it.
 *
 * Run after `npm run build`: node dist/real/real-document-compiler.test.js
 * Requires career-ops's own node_modules (playwright) to be installed —
 * run from within the career-ops project, not synthesis/ in isolation.
 */
export {};
//# sourceMappingURL=real-document-compiler.test.d.ts.map