/**
 * Stub IExperienceTailor — rewrites job titles and bullet highlights
 * to match the target role's vocabulary.
 * In production this would use LLM rewriting or RAG.
 */
/** Simulated tailoring data per company. */
const TAILORING_DB = {
    'acme-widgets-1': {
        title: 'Senior Platform Engineer',
        bullets: [
            'Architected Kubernetes-based deployment platform serving 2M RPM across 12 services',
            'Designed Terraform modules for multi-region AWS infrastructure, reducing provisioning from 3 days to 20 minutes',
            'Built GitHub Actions CI/CD pipeline with automated canary deployments and rollback',
        ],
    },
    'globex-corp-2': {
        title: 'Infrastructure Engineer',
        bullets: [
            'Migrated legacy VM fleet to containerized workloads on EKS, achieving 40% cost reduction',
            'Implemented Prometheus + Grafana observability stack with custom SLO dashboards',
            'Led cross-team initiative to standardize Docker images, cutting CVE exposure by 85%',
        ],
    },
    'initech-3': {
        title: 'DevOps Engineer',
        bullets: [
            'Established Infrastructure-as-Code practices using Terraform across 3 engineering teams',
            'Designed ArgoCD-based GitOps workflow for continuous deployment to staging and production',
        ],
    },
};
export class StubExperienceTailor {
    async tailor(matrix, companyIds) {
        await delay(180); // Simulate LLM calls
        const result = new Map();
        for (const id of companyIds) {
            const data = TAILORING_DB[id];
            if (data) {
                result.set(id, {
                    tailoredTitle: data.title,
                    highlights: data.bullets,
                });
            }
            // Companies not in TAILORING_DB are intentionally skipped —
            // the merge algorithm handles unmatched entries gracefully.
        }
        return result;
    }
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=stub-experience-tailor.js.map