/**
 * Stub ITargetAnalyzer — parses the JD text into a TargetMatrix.
 * In production this would use an LLM or NLP pipeline.
 */

import type { ITargetAnalyzer } from '../interfaces/target-analyzer.js';
import type { TargetMatrix } from '../types/target-matrix.js';

export class StubTargetAnalyzer implements ITargetAnalyzer {
  async analyze(source: string): Promise<TargetMatrix> {
    await delay(90);

    return {
      roleTitle: 'Senior Platform Engineer',
      companyName: 'Acme Corp',
      requiredSkills: [
        'Kubernetes', 'Docker', 'Terraform', 'CI/CD',
        'GitHub Actions', 'ArgoCD', 'Prometheus', 'Grafana',
      ],
      preferredSkills: ['Go', 'Rust', 'Istio', 'Cost optimization'],
      responsibilityThemes: [
        'Design cloud infrastructure',
        'Maintain CI/CD pipelines',
        'Ensure system reliability at scale',
        'Cross-team collaboration',
      ],
      industryContext: ['cloud infrastructure', 'platform engineering', 'DevOps'],
      senioritySignal: 'senior',
      location: 'Remote (US)',
      rawSource: source,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
