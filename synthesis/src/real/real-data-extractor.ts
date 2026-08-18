/**
 * Real IDataExtractor — wraps the existing, already-hardened
 * browser-extract.mjs (headless Playwright JD reader) rather than
 * reimplementing scraping. Same script career-ops's own scan/pipeline modes
 * use when CAREER_OPS scan.extractor is set to "cli" — this is not a second,
 * competing extraction path.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IDataExtractor, ExtractedContent } from '../interfaces/data-extractor.js';
import { SynthesisError } from '../errors/synthesis-errors.js';

export interface RealDataExtractorOptions {
  /** Absolute path to the career-ops project root (where browser-extract.mjs lives). */
  readonly careerOpsRoot: string;
  /** Timeout in ms for the extraction subprocess. Default: 30000. */
  readonly timeoutMs?: number;
}

interface BrowserExtractJdResult {
  url: string;
  title: string;
  text: string;
}

interface BrowserExtractError {
  error: string;
  code: string;
}

function isExtractError(x: unknown): x is BrowserExtractError {
  return typeof x === 'object' && x !== null && 'error' in x && 'code' in x;
}

export class RealDataExtractor implements IDataExtractor {
  private readonly scriptPath: string;
  private readonly timeoutMs: number;

  constructor(opts: RealDataExtractorOptions) {
    this.scriptPath = join(opts.careerOpsRoot, 'browser-extract.mjs');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    if (!existsSync(this.scriptPath)) {
      throw new SynthesisError('extract', `browser-extract.mjs not found at ${this.scriptPath} — is careerOpsRoot correct?`);
    }
  }

  async extract(source: string): Promise<ExtractedContent> {
    const result = spawnSync(process.execPath, [this.scriptPath, source, '--mode', 'jd'], {
      encoding: 'utf-8',
      timeout: this.timeoutMs,
    });

    if (result.error) {
      throw new SynthesisError('extract', `Failed to spawn browser-extract.mjs: ${result.error.message}`, { cause: result.error });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout || '{}');
    } catch (err) {
      throw new SynthesisError('extract', `browser-extract.mjs produced non-JSON output: ${result.stdout.slice(0, 300)}`, {
        cause: err,
        context: { stderr: result.stderr.slice(0, 500) },
      });
    }

    if (result.status !== 0 || isExtractError(parsed)) {
      const errInfo = isExtractError(parsed) ? parsed : { error: 'unknown', code: 'unknown' };
      throw new SynthesisError('extract', `browser-extract.mjs failed: ${errInfo.error} (${errInfo.code})`, {
        context: { source, exitCode: result.status },
      });
    }

    const jd = parsed as BrowserExtractJdResult;
    if (!jd.text) {
      throw new SynthesisError('extract', 'browser-extract.mjs returned no text content', { context: { source } });
    }

    return Object.freeze({
      text: jd.text,
      title: jd.title ?? '',
      resolvedUrl: jd.url ?? source,
      metadata: Object.freeze({}),
      extractedAt: new Date().toISOString(),
    });
  }
}
