/**
 * Headless AI bridge — the single mechanism every AI-driven stage
 * (Analyze/Synthesize/Tailor) uses to get real reasoning inside a
 * synchronous script run.
 *
 * This is NOT a second evaluation engine. It spawns the SAME `claude -p`
 * headless worker batch/batch-runner.sh already uses (identical flags,
 * identical model resolution from spend_tier, identical last-fenced-```json
 * -block extraction convention) and feeds it the SAME modes/_shared.md +
 * modes/_profile.md + modes/_custom.md context every other career-ops mode
 * reads. One source of truth for "how career-ops reasons about a JD" — this
 * bridge only adds a schema instruction and a structured-JSON contract on
 * top of it, so the orchestrator gets a typed answer back instead of prose.
 */
import { type SynthesisStage } from '../errors/synthesis-errors.js';
export type SpendTier = 'economy' | 'standard' | 'premium';
export interface HeadlessAiBridgeOptions {
    /** Absolute path to the career-ops project root. */
    readonly careerOpsRoot: string;
    /** Explicit model override. When absent, resolved from config/profile.yml's spend_tier. */
    readonly model?: string;
    /** Timeout in ms for the claude -p subprocess. Default: 180000 (3 min). */
    readonly timeoutMs?: number;
    /** Override the CLI binary — for tests. Default: 'claude'. */
    readonly claudeBinary?: string;
}
/**
 * Resolve the model to invoke: explicit override wins, else spend_tier from
 * config/profile.yml (default 'standard' when absent/invalid — same
 * fallback rule as modes/_shared.md's own Resolution paragraph).
 */
export declare function resolveModel(careerOpsRoot: string, explicitModel?: string): string;
/**
 * Build the full system-prompt content: the same context every other
 * career-ops mode injects (see .agents/skills/career-ops/SKILL.md → "Context
 * Loading by Mode"), plus this stage's task-specific instructions.
 */
export declare function buildSystemPrompt(careerOpsRoot: string, stageInstructions: string): string;
/**
 * Extract the LAST fenced ```json block from text — the same convention
 * batch-runner.sh's process_offer() uses (its own comment: "that's the
 * worker's one authoritative final result... not arbitrary text anywhere
 * else in stdout/stderr").
 */
export declare function extractLastJsonBlock(text: string): string | null;
/**
 * Invoke the headless AI worker with a system prompt (career-ops context +
 * stage instructions) and a user prompt (the actual request), expecting a
 * JSON object back in the last ```json fenced block. Throws SynthesisError
 * on spawn failure, timeout, non-zero exit, or an unparseable/missing
 * response block.
 */
export declare function invokeHeadlessAi(stage: SynthesisStage, systemPrompt: string, userPrompt: string, opts: HeadlessAiBridgeOptions): unknown;
//# sourceMappingURL=headless-ai-bridge.d.ts.map