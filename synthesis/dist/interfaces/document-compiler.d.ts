/**
 * IDocumentCompiler
 *
 * Renders a MergedPortfolio into a compiled document buffer.
 * The compiler is the final stage of the pipeline — it accepts the
 * fully merged state and produces output in the target format
 * (PDF, HTML, LaTeX, Markdown, JSON).
 *
 * Concrete implementations may use Playwright PDF rendering, LaTeX
 * compilation, or Handlebars/Mustache templating — the orchestrator
 * is agnostic to the rendering strategy.
 *
 * OUT OF SCOPE for this sprint: the actual compilation logic.
 */
import type { MergedPortfolio } from '../types/merged-output.js';
export interface CompiledDocument {
    /** The compiled output as a binary buffer. */
    readonly buffer: Buffer;
    /** MIME type of the output (e.g., "application/pdf", "text/html"). */
    readonly mimeType: string;
    /** Suggested filename for the output. */
    readonly filename: string;
    /** Size in bytes. */
    readonly sizeBytes: number;
}
export interface IDocumentCompiler {
    /**
     * Compile a merged portfolio into a document buffer.
     *
     * @param portfolio - The fully merged portfolio state.
     * @returns Compiled document with metadata.
     * @throws SynthesisError with stage = 'compile' on failure.
     */
    compile(portfolio: MergedPortfolio): Promise<CompiledDocument>;
}
//# sourceMappingURL=document-compiler.d.ts.map