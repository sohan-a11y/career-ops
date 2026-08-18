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

// ── Types ───────────────────────────────────────────────────────
export type {
  ImmutableProfile,
  EmploymentRecord,
} from './types/immutable-profile.js';

export type {
  MutablePayload,
  MutableEmploymentData,
} from './types/mutable-payload.js';

export type {
  TargetMatrix,
} from './types/target-matrix.js';

export type {
  MergedPortfolio,
  MergedEmploymentEntry,
  MergeStats,
} from './types/merged-output.js';

export type {
  ScoreResult,
  DimensionScores,
  FinalDecision,
  RiskLevel,
  ConfidenceLevel,
} from './types/score-result.js';

// ── Interfaces ──────────────────────────────────────────────────
export type { ITargetAnalyzer } from './interfaces/target-analyzer.js';

export type {
  IPortfolioSynthesizer,
  SynthesizedPayload,
} from './interfaces/portfolio-synthesizer.js';

export type { IExperienceTailor } from './interfaces/experience-tailor.js';

export type {
  IDataExtractor,
  ExtractedContent,
} from './interfaces/data-extractor.js';

export type {
  IDocumentCompiler,
  CompiledDocument,
} from './interfaces/document-compiler.js';

export type { IResumeScorer } from './interfaces/resume-scorer.js';

// ── Engine ──────────────────────────────────────────────────────
export {
  DynamicPortfolioOrchestrator,
  type OrchestratorConfig,
  type PipelineEvent,
  type EventListener,
} from './orchestrator/dynamic-portfolio-orchestrator.js';

// ── Errors ──────────────────────────────────────────────────────
export {
  SynthesisError,
  MergeConflictError,
  StageTimeoutError,
  type SynthesisStage,
} from './errors/synthesis-errors.js';

// ── Real profile loading (cv.md + config/profile.yml → ImmutableProfile) ──
export {
  loadImmutableProfile,
  ProfileLoadError,
  type LoadImmutableProfileOptions,
} from './profile/load-immutable-profile.js';

// ── Real implementations (no stubs — see synthesis/README.md) ──────
export { RealDataExtractor, type RealDataExtractorOptions } from './real/real-data-extractor.js';
export { RealTargetAnalyzer, type RealTargetAnalyzerOptions } from './real/real-target-analyzer.js';
export { RealPortfolioSynthesizer, type RealPortfolioSynthesizerOptions } from './real/real-portfolio-synthesizer.js';
export { RealExperienceTailor, type RealExperienceTailorOptions } from './real/real-experience-tailor.js';
export { RealDocumentCompiler, type RealDocumentCompilerOptions } from './real/real-document-compiler.js';
export { RealResumeScorer, type RealResumeScorerOptions } from './real/real-resume-scorer.js';
export {
  invokeHeadlessAi,
  resolveModel,
  buildSystemPrompt,
  extractLastJsonBlock,
  type HeadlessAiBridgeOptions,
  type SpendTier,
} from './real/headless-ai-bridge.js';
