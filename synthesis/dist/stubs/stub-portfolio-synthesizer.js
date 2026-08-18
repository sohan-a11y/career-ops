/**
 * Stub IPortfolioSynthesizer — generates a tailored summary,
 * competencies, and project selection.
 * In production this would use multi-agent LLM orchestration.
 */
export class StubPortfolioSynthesizer {
    async synthesize(matrix) {
        await delay(200); // Simulate LLM call
        return {
            professionalSummary: [
                `${matrix.senioritySignal === 'senior' ? 'Senior' : ''} Platform Engineer`,
                `with 7+ years designing and scaling cloud-native infrastructure.`,
                `Proven track record in ${matrix.requiredSkills.slice(0, 3).join(', ')},`,
                `with deep expertise in reliability engineering and CI/CD automation.`,
            ].join(' '),
            coreCompetencies: [
                ...matrix.requiredSkills.slice(0, 6),
                'Infrastructure as Code',
                'Site Reliability Engineering',
                'Cloud Cost Optimization',
                'System Design',
            ],
            tailoredProjects: [
                {
                    name: 'K8s Migration Platform',
                    description: 'Led migration of 40+ microservices from EC2 to EKS, reducing deployment time by 70%',
                    techStack: ['Kubernetes', 'Terraform', 'ArgoCD', 'Helm'],
                    relevanceScore: 0.95,
                },
                {
                    name: 'Observability Stack',
                    description: 'Built unified monitoring with Prometheus, Grafana, and custom alerting reducing MTTR by 60%',
                    techStack: ['Prometheus', 'Grafana', 'Go', 'PagerDuty'],
                    relevanceScore: 0.88,
                },
                {
                    name: 'CI/CD Pipeline Overhaul',
                    description: 'Redesigned build pipelines with GitHub Actions, cutting build times from 25m to 4m',
                    techStack: ['GitHub Actions', 'Docker', 'Buildkit', 'Trivy'],
                    relevanceScore: 0.82,
                },
            ],
        };
    }
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=stub-portfolio-synthesizer.js.map