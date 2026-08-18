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

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { SynthesisError, type SynthesisStage } from '../errors/synthesis-errors.js';

export type SpendTier = 'economy' | 'standard' | 'premium';

// Mirrors the ONE canonical table in modes/_shared.md exactly (Claude Code
// row). Keep in sync with that table and with batch/batch-runner.sh's
// spend_tier_to_model() — three independent call sites intentionally kept
// textually identical rather than sharing code across a .sh/.mjs/.ts
// boundary, same tradeoff batch-runner.sh already made.
const TIER_TO_MODEL: Record<SpendTier, string> = {
  economy: 'claude-haiku-4-5',
  standard: 'claude-sonnet-5',
  premium: 'claude-opus-5',
};

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
export function resolveModel(careerOpsRoot: string, explicitModel?: string): string {
  if (explicitModel) return explicitModel;

  const profilePath = join(careerOpsRoot, 'config', 'profile.yml');
  let tier: string = 'standard';
  if (existsSync(profilePath)) {
    try {
      const parsed = yaml.load(readFileSync(profilePath, 'utf-8')) as { spend_tier?: string } | undefined;
      if (parsed?.spend_tier && parsed.spend_tier in TIER_TO_MODEL) {
        tier = parsed.spend_tier;
      }
    } catch {
      // Malformed profile.yml — fall back to standard, same as the shell path.
    }
  }
  return TIER_TO_MODEL[tier as SpendTier] ?? TIER_TO_MODEL.standard;
}

/**
 * Read a file's content if it exists, else return ''. Used to compose the
 * system-prompt context out of whichever of _shared.md/_profile.md/_custom.md
 * are actually present — mirrors batch-runner.sh's own "for context_file in
 * ...; if -f" loop.
 */
function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

/**
 * Build the full system-prompt content: the same context every other
 * career-ops mode injects (see .agents/skills/career-ops/SKILL.md → "Context
 * Loading by Mode"), plus this stage's task-specific instructions.
 */
export function buildSystemPrompt(careerOpsRoot: string, stageInstructions: string): string {
  const parts = [
    readIfExists(join(careerOpsRoot, 'modes', '_shared.md')),
    readIfExists(join(careerOpsRoot, 'modes', '_profile.md')),
    readIfExists(join(careerOpsRoot, 'modes', '_custom.md')),
    stageInstructions,
  ].filter(Boolean);
  return parts.join('\n\n---\n\n');
}

/**
 * Extract the LAST fenced ```json block from text — the same convention
 * batch-runner.sh's process_offer() uses (its own comment: "that's the
 * worker's one authoritative final result... not arbitrary text anywhere
 * else in stdout/stderr").
 */
export function extractLastJsonBlock(text: string): string | null {
  const matches = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  const last = matches.at(-1);
  return last?.[1] ?? null;
}

/**
 * Invoke the headless AI worker with a system prompt (career-ops context +
 * stage instructions) and a user prompt (the actual request), expecting a
 * JSON object back in the last ```json fenced block. Throws SynthesisError
 * on spawn failure, timeout, non-zero exit, or an unparseable/missing
 * response block.
 */
export function invokeHeadlessAi(
  stage: SynthesisStage,
  systemPrompt: string,
  userPrompt: string,
  opts: HeadlessAiBridgeOptions,
): unknown {
  const model = resolveModel(opts.careerOpsRoot, opts.model);
  const claudeBinary = opts.claudeBinary ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const scratchDir = mkdtempSync(join(tmpdir(), 'career-ops-synthesis-'));
  const systemPromptFile = join(scratchDir, 'system-prompt.md');
  writeFileSync(systemPromptFile, systemPrompt);

  try {
    // Same flags as batch/batch-runner.sh's process_offer(): -p for
    // non-interactive, --dangerously-skip-permissions because a worker with
    // no human present cannot answer a permission prompt,
    // --strict-mcp-config with no --mcp-config so parallel workers never
    // fight over one shared browser session (issue #506), and
    // --append-system-prompt-file to inject the SAME context every
    // interactive mode reads.
    const result = spawnSync(
      claudeBinary,
      ['-p', '--dangerously-skip-permissions', '--strict-mcp-config', '--model', model, '--append-system-prompt-file', systemPromptFile, userPrompt],
      { encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 },
    );

    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === 'ETIMEDOUT') {
        throw new SynthesisError(stage, `Headless AI worker (${model}) timed out after ${timeoutMs}ms`, { cause: result.error });
      }
      throw new SynthesisError(stage, `Failed to spawn '${claudeBinary}': ${result.error.message}. Is the Claude Code CLI installed and on PATH?`, { cause: result.error });
    }

    if (result.status !== 0) {
      throw new SynthesisError(stage, `Headless AI worker exited ${result.status}`, {
        context: { stderr: result.stderr.slice(0, 1000), stdoutTail: result.stdout.slice(-1000) },
      });
    }

    const jsonText = extractLastJsonBlock(result.stdout);
    if (!jsonText) {
      throw new SynthesisError(stage, 'Headless AI worker produced no fenced ```json block in its response', {
        context: { stdoutTail: result.stdout.slice(-1000) },
      });
    }

    try {
      return JSON.parse(jsonText);
    } catch (err) {
      throw new SynthesisError(stage, 'Headless AI worker\'s ```json block was not valid JSON', {
        cause: err,
        context: { jsonText: jsonText.slice(0, 1000) },
      });
    }
  } finally {
    try { unlinkSync(systemPromptFile); } catch { /* best-effort cleanup */ }
  }
}
