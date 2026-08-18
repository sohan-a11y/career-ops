/**
 * Real ITargetAnalyzer — extracts a TargetMatrix from a real JD via the
 * headless AI bridge (see headless-ai-bridge.ts). Reads the JD through the
 * SAME lens modes/oferta.md's Block A/B already use — no separate,
 * competing extraction logic.
 */

import type { ITargetAnalyzer } from '../interfaces/target-analyzer.js';
import type { TargetMatrix } from '../types/target-matrix.js';
import { SynthesisError } from '../errors/synthesis-errors.js';
import { invokeHeadlessAi, buildSystemPrompt, type HeadlessAiBridgeOptions } from './headless-ai-bridge.js';

const STAGE_INSTRUCTIONS = `## Synthesis Pipeline — Analyze Stage

You are performing the ANALYZE stage of the Dynamic Portfolio Synthesis Pipeline. Read the job description that follows and extract a structured requirements matrix from it, using the same judgment Block A/B of the evaluation instructions above already apply.

Respond with ONLY a single fenced \`\`\`json code block (nothing before or after it) containing an object with EXACTLY this shape:

\`\`\`json
{
  "roleTitle": "string — the role title as stated in the JD",
  "companyName": "string — the hiring company's name",
  "requiredSkills": ["string", "..."],
  "preferredSkills": ["string", "..."],
  "responsibilityThemes": ["string", "..."],
  "industryContext": ["string", "..."],
  "senioritySignal": "string — e.g. senior, staff, lead, principal, or empty string if ambiguous",
  "location": "string — the job location exactly as the JD states it (e.g. 'Remote (US)', 'London, UK', 'Bengaluru, India'), or empty string if the JD doesn't say"
}
\`\`\`

Order requiredSkills and preferredSkills by emphasis (most-mentioned or most-prominent first). Base every field strictly on the JD text given — never invent a requirement the posting doesn't state.`;

export interface RealTargetAnalyzerOptions extends HeadlessAiBridgeOptions {}

interface AnalyzeResponse {
  roleTitle?: string;
  companyName?: string;
  requiredSkills?: string[];
  preferredSkills?: string[];
  responsibilityThemes?: string[];
  industryContext?: string[];
  senioritySignal?: string;
  location?: string;
}

export class RealTargetAnalyzer implements ITargetAnalyzer {
  constructor(private readonly opts: RealTargetAnalyzerOptions) {}

  async analyze(source: string): Promise<TargetMatrix> {
    const systemPrompt = buildSystemPrompt(this.opts.careerOpsRoot, STAGE_INSTRUCTIONS);
    const userPrompt = `Job description to analyze:\n\n${source}`;

    const raw = invokeHeadlessAi('analyze', systemPrompt, userPrompt, this.opts) as AnalyzeResponse;

    if (!raw || typeof raw !== 'object') {
      throw new SynthesisError('analyze', 'Headless AI worker returned a non-object response for the Analyze stage');
    }

    return Object.freeze({
      roleTitle: raw.roleTitle ?? '',
      companyName: raw.companyName ?? '',
      requiredSkills: Object.freeze([...(raw.requiredSkills ?? [])]),
      preferredSkills: Object.freeze([...(raw.preferredSkills ?? [])]),
      responsibilityThemes: Object.freeze([...(raw.responsibilityThemes ?? [])]),
      industryContext: Object.freeze([...(raw.industryContext ?? [])]),
      senioritySignal: raw.senioritySignal ?? '',
      location: raw.location ?? '',
      rawSource: source,
    });
  }
}
