/**
 * @career-ops/synthesis
 *
 * Dynamic Portfolio Synthesis Pipeline: Extract → Analyze →
 * [Synthesize ‖ Tailor] → Merge → Compile → Score (optional).
 *
 * Public API surface:
 *   - Types:       ImmutableProfile, MutablePayload, TargetMatrix, MergedPortfolio, ScoreResult
 *   - Interfaces:  ITargetAnalyzer, IPortfolioSynthesizer, IExperienceTailor,
 *                  IDataExtractor, IDocumentCompiler, IResumeScorer
 *   - Engine:      DynamicPortfolioOrchestrator
 *   - Errors:      SynthesisError, MergeConflictError, StageTimeoutError
 */
// ── Engine ──────────────────────────────────────────────────────
export { DynamicPortfolioOrchestrator, } from './orchestrator/dynamic-portfolio-orchestrator.js';
// ── Errors ──────────────────────────────────────────────────────
export { SynthesisError, MergeConflictError, StageTimeoutError, } from './errors/synthesis-errors.js';
// ── Real profile loading (cv.md + config/profile.yml → ImmutableProfile) ──
export { loadImmutableProfile, ProfileLoadError, } from './profile/load-immutable-profile.js';
// ── Real implementations (no stubs — see synthesis/README.md) ──────
export { RealDataExtractor } from './real/real-data-extractor.js';
export { RealTargetAnalyzer } from './real/real-target-analyzer.js';
export { RealPortfolioSynthesizer } from './real/real-portfolio-synthesizer.js';
export { RealExperienceTailor } from './real/real-experience-tailor.js';
export { RealDocumentCompiler } from './real/real-document-compiler.js';
export { RealResumeScorer } from './real/real-resume-scorer.js';
export { invokeHeadlessAi, resolveModel, buildSystemPrompt, extractLastJsonBlock, } from './real/headless-ai-bridge.js';
//# sourceMappingURL=index.js.map