/**
 * Real IPortfolioSynthesizer — produces a tailored professional summary,
 * core competencies, and project selection via the headless AI bridge.
 *
 * The interface only takes a TargetMatrix, so this concrete implementation
 * reads the user's REAL cv.md Projects/Skills sections itself (constructor
 * takes careerOpsRoot) and hands that raw source material to the AI worker
 * as context — exactly mirroring modes/pdf.md Step 11 ("select top 3-4 most
 * relevant projects") and Step 13 ("build competency grid... prioritizing
 * existing/supportedByResume skills"). The worker is told explicitly to
 * select and reword from what's given, never invent — same "Keywords get
 * reformulated, never fabricated" rule as every other mode (AGENTS.md).
 *
 * tailoredProjects entries use the exact shape build-cv-html.mjs's
 * `projects[]` field expects ({name, badge?, tech?, description}) so
 * RealDocumentCompiler can pass them straight through with no extra mapping.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IPortfolioSynthesizer, SynthesizedPayload } from '../interfaces/portfolio-synthesizer.js';
import type { TargetMatrix } from '../types/target-matrix.js';
import { SynthesisError } from '../errors/synthesis-errors.js';
import { extractSection } from '../profile/load-immutable-profile.js';
import { invokeHeadlessAi, buildSystemPrompt, type HeadlessAiBridgeOptions } from './headless-ai-bridge.js';

const STAGE_INSTRUCTIONS = `## Synthesis Pipeline — Synthesize Stage

You are performing the SYNTHESIZE stage of the Dynamic Portfolio Synthesis Pipeline. You are given the target requirements matrix (extracted from the JD) and the candidate's REAL Projects and Skills sections verbatim from cv.md. Produce a tailored professional summary, core competency list, and project selection.

**Hard rule (same as every other career-ops mode): reword and reorder, never invent.** Every competency and every project must trace back to something literally present in the source sections given below. If the target matrix asks for a skill the source material has no trace of, leave it out — do not add it to make the match look stronger.

Respond with ONLY a single fenced \`\`\`json code block (nothing before or after it) containing an object with EXACTLY this shape:

\`\`\`json
{
  "professionalSummary": "string — 2-4 sentences, keyword-dense, grounded in the source material",
  "coreCompetencies": ["string", "... 6-8 keyword phrases"],
  "tailoredProjects": [
    { "name": "string", "badge": "string (optional)", "tech": "string (optional)", "description": "string" }
  ]
}
\`\`\`

Select the 3-4 projects from the source material most relevant to the target matrix's requiredSkills/responsibilityThemes; reorder and reword their descriptions to foreground matching keywords, but never alter a fact (metrics, tech stack, what was actually built).`;

export interface RealPortfolioSynthesizerOptions extends HeadlessAiBridgeOptions {}

interface SynthesizeResponse {
  professionalSummary?: string;
  coreCompetencies?: string[];
  tailoredProjects?: unknown[];
}

export class RealPortfolioSynthesizer implements IPortfolioSynthesizer {
  constructor(private readonly opts: RealPortfolioSynthesizerOptions) {}

  async synthesize(matrix: TargetMatrix): Promise<SynthesizedPayload> {
    const cvPath = join(this.opts.careerOpsRoot, 'cv.md');
    if (!existsSync(cvPath)) {
      throw new SynthesisError('synthesize', `cv.md not found at ${cvPath}`);
    }
    const cvMarkdown = readFileSync(cvPath, 'utf-8');
    const projectsSection = extractSection(cvMarkdown, /^##\s+Projects\s*$/i);
    const skillsSection = extractSection(cvMarkdown, /^##\s+Skills\s*$/i);
    const summarySection = extractSection(cvMarkdown, /^##\s+Summary\s*$/i);

    const systemPrompt = buildSystemPrompt(this.opts.careerOpsRoot, STAGE_INSTRUCTIONS);
    const userPrompt = [
      `Target requirements matrix:\n${JSON.stringify(matrix, null, 2)}`,
      `Candidate's cv.md — Summary section (verbatim source material):\n${summarySection || '(none)'}`,
      `Candidate's cv.md — Skills section (verbatim source material):\n${skillsSection || '(none)'}`,
      `Candidate's cv.md — Projects section (verbatim source material):\n${projectsSection || '(none)'}`,
    ].join('\n\n---\n\n');

    const raw = invokeHeadlessAi('synthesize', systemPrompt, userPrompt, this.opts) as SynthesizeResponse;

    if (!raw || typeof raw !== 'object') {
      throw new SynthesisError('synthesize', 'Headless AI worker returned a non-object response for the Synthesize stage');
    }

    return Object.freeze({
      professionalSummary: raw.professionalSummary ?? '',
      coreCompetencies: Object.freeze([...(raw.coreCompetencies ?? [])]),
      tailoredProjects: Object.freeze([...(raw.tailoredProjects ?? [])]),
    });
  }
}
