/**
 * Real IExperienceTailor — resolves tailored titles and reworded highlights
 * per companyId via the headless AI bridge, using ONLY the candidate's real,
 * as-written cv.md bullets as source material (see
 * load-immutable-profile.ts's extractRawBulletsByCompanyId).
 *
 * One AI call covers every companyId in a single request rather than one
 * call per role — the interface already batches all companyIds together,
 * and there's no reason to pay N subprocess-spawn/model-inference costs
 * when one structured request can return the whole map.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IExperienceTailor } from '../interfaces/experience-tailor.js';
import type { TargetMatrix } from '../types/target-matrix.js';
import type { MutableEmploymentData } from '../types/mutable-payload.js';
import { SynthesisError } from '../errors/synthesis-errors.js';
import { extractSection, parseExperienceEntries, extractRawBulletsByCompanyId, assignCompanyIds } from '../profile/load-immutable-profile.js';
import { invokeHeadlessAi, buildSystemPrompt, type HeadlessAiBridgeOptions } from './headless-ai-bridge.js';

const STAGE_INSTRUCTIONS = `## Synthesis Pipeline — Tailor Stage

You are performing the TAILOR stage of the Dynamic Portfolio Synthesis Pipeline. For EACH role given below (keyed by companyId), you are given the ORIGINAL job title and the candidate's REAL, as-written achievement bullets for that role — reword and reorder them to foreground whatever matches the target requirements matrix, and propose a tailored title if the target role's vocabulary differs from the original.

**Hard rule (same as every other career-ops mode — "Keywords get reformulated, never fabricated"):** every highlight you return must be a reworded version of a bullet actually given for that companyId. Never invent a new achievement, a new metric, or a new bullet not traceable to the source list. If a role's source bullets are genuinely empty, return an empty highlights array for it rather than inventing content — do not skip the companyId itself.

Respond with ONLY a single fenced \`\`\`json code block (nothing before or after it) containing an object keyed by companyId, where each value has this shape:

\`\`\`json
{
  "<companyId>": {
    "tailoredTitle": "string",
    "highlights": ["string", "..."]
  }
}
\`\`\`

Include EVERY companyId listed below, even ones with no source bullets to draw from (empty highlights array in that case).`;

export interface RealExperienceTailorOptions extends HeadlessAiBridgeOptions {}

type TailorResponse = Record<string, { tailoredTitle?: string; highlights?: string[] } | undefined>;

export class RealExperienceTailor implements IExperienceTailor {
  constructor(private readonly opts: RealExperienceTailorOptions) {}

  async tailor(matrix: TargetMatrix, companyIds: readonly string[]): Promise<ReadonlyMap<string, MutableEmploymentData>> {
    const cvPath = join(this.opts.careerOpsRoot, 'cv.md');
    if (!existsSync(cvPath)) {
      throw new SynthesisError('tailor', `cv.md not found at ${cvPath}`);
    }
    const cvMarkdown = readFileSync(cvPath, 'utf-8');
    const experienceSection = extractSection(cvMarkdown, /^##\s+Experience\s*$/i);
    const entries = parseExperienceEntries(experienceSection);
    const bulletsByCompanyId = extractRawBulletsByCompanyId(entries);
    const titlesByCompanyId = new Map(assignCompanyIds(entries).map((e) => [e.companyId, e.title]));

    if (companyIds.length === 0) {
      return new Map();
    }

    const roleContext = companyIds.map((id) => ({
      companyId: id,
      originalTitle: titlesByCompanyId.get(id) ?? '(unknown — not found in cv.md)',
      sourceBullets: bulletsByCompanyId.get(id) ?? [],
    }));

    const systemPrompt = buildSystemPrompt(this.opts.careerOpsRoot, STAGE_INSTRUCTIONS);
    const userPrompt = [
      `Target requirements matrix:\n${JSON.stringify(matrix, null, 2)}`,
      `Roles to tailor (companyId → original title + real source bullets):\n${JSON.stringify(roleContext, null, 2)}`,
    ].join('\n\n---\n\n');

    const raw = invokeHeadlessAi('tailor', systemPrompt, userPrompt, this.opts) as TailorResponse;

    if (!raw || typeof raw !== 'object') {
      throw new SynthesisError('tailor', 'Headless AI worker returned a non-object response for the Tailor stage');
    }

    const result = new Map<string, MutableEmploymentData>();
    for (const id of companyIds) {
      const entry = raw[id];
      if (!entry) continue; // absent companyId → simply unmatched at merge time, not fatal here
      result.set(id, Object.freeze({
        tailoredTitle: entry.tailoredTitle ?? titlesByCompanyId.get(id) ?? '',
        highlights: Object.freeze([...(entry.highlights ?? [])]),
      }));
    }
    return result;
  }
}
