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
export {};
//# sourceMappingURL=document-compiler.js.map