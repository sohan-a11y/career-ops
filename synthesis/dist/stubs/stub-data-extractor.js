/**
 * Stub IDataExtractor — returns hardcoded JD text.
 * In production this would use Playwright/Puppeteer to scrape a live URL.
 */
export class StubDataExtractor {
    async extract(source) {
        // Simulate network latency
        await delay(120);
        return {
            text: [
                'Senior Platform Engineer — Acme Corp',
                '',
                'We are looking for a Senior Platform Engineer to design and maintain',
                'our cloud infrastructure. You will work with Kubernetes, Terraform,',
                'and CI/CD pipelines to keep our systems reliable at scale.',
                '',
                'Requirements:',
                '• 5+ years backend/infrastructure experience',
                '• Strong Kubernetes and Docker expertise',
                '• Experience with Terraform or Pulumi for IaC',
                '• CI/CD pipeline design (GitHub Actions, ArgoCD)',
                '• Monitoring and observability (Prometheus, Grafana, Datadog)',
                '• Strong communication skills for cross-team collaboration',
                '',
                'Nice to have:',
                '• Go or Rust for internal tooling',
                '• Experience with service mesh (Istio, Linkerd)',
                '• Cost optimization on AWS/GCP',
                '',
                'We offer competitive compensation ($180K–$220K), remote-first culture,',
                'and a team that values craft over velocity.',
            ].join('\n'),
            title: 'Senior Platform Engineer — Acme Corp',
            resolvedUrl: source.startsWith('http') ? source : `https://acme.corp/jobs/${source}`,
            metadata: { atsVendor: 'greenhouse', reqId: 'JR-10423' },
            extractedAt: new Date().toISOString(),
        };
    }
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=stub-data-extractor.js.map