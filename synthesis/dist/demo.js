/**
 * Demo Runner — executes the full synthesis pipeline end-to-end.
 *
 * Usage:
 *   npx tsx src/demo.ts
 *   npx tsx src/demo.ts "https://acme.corp/jobs/platform-eng"
 *
 * This wires up the stub implementations, feeds a sample immutable
 * profile, and runs the orchestrator with live telemetry output.
 */
import { DynamicPortfolioOrchestrator } from './orchestrator/dynamic-portfolio-orchestrator.js';
import { StubDataExtractor } from './stubs/stub-data-extractor.js';
import { StubTargetAnalyzer } from './stubs/stub-target-analyzer.js';
import { StubPortfolioSynthesizer } from './stubs/stub-portfolio-synthesizer.js';
import { StubExperienceTailor } from './stubs/stub-experience-tailor.js';
import { StubDocumentCompiler } from './stubs/stub-document-compiler.js';
// ── Sample Immutable Profile ────────────────────────────────────────
const SAMPLE_PROFILE = {
    contactInfo: {
        name: 'Alex Chen',
        email: 'alex.chen@example.com',
        phone: '+1-555-0142',
        location: 'San Francisco, CA',
        linkedin: 'linkedin.com/in/alexchen',
        github: 'github.com/alexchen',
    },
    certifications: [
        'AWS Solutions Architect – Professional',
        'Certified Kubernetes Administrator (CKA)',
        'HashiCorp Terraform Associate',
    ],
    education: [
        {
            institution: 'UC Berkeley',
            degree: 'B.S. Computer Science',
            year: 2017,
        },
    ],
    employmentHistory: [
        {
            companyId: 'acme-widgets-1',
            companyName: 'Acme Widgets Inc.',
            startDate: '2022-03',
            endDate: 'present',
        },
        {
            companyId: 'globex-corp-2',
            companyName: 'Globex Corporation',
            startDate: '2019-06',
            endDate: '2022-02',
        },
        {
            companyId: 'initech-3',
            companyName: 'Initech LLC',
            startDate: '2017-08',
            endDate: '2019-05',
        },
        {
            companyId: 'summer-intern-4',
            companyName: 'StartupCo (Internship)',
            startDate: '2016-06',
            endDate: '2016-08',
        },
    ],
};
// ── Telemetry logger ────────────────────────────────────────────────
const STAGE_ICONS = {
    extract: '🔍',
    analyze: '🧠',
    synthesize: '⚡',
    tailor: '✂️',
    merge: '🔗',
    compile: '📄',
};
function logEvent(event) {
    const icon = 'stage' in event ? (STAGE_ICONS[event.stage] ?? '•') : '•';
    switch (event.kind) {
        case 'stage-start':
            console.log(`  ${icon}  ${event.stage} started…`);
            break;
        case 'stage-complete':
            console.log(`  ${icon}  ${event.stage} done (${event.durationMs.toFixed(0)}ms)`);
            break;
        case 'stage-error':
            console.log(`  ❌  ${event.stage} FAILED: ${event.error}`);
            break;
        case 'merge-stats':
            console.log(`\n  📊  Merge Stats:`);
            console.log(`      Total entries:     ${event.stats.totalImmutableEntries}`);
            console.log(`      Matched:           ${event.stats.matchedEntries}`);
            console.log(`      Unmatched:         ${event.stats.unmatchedEntries}`);
            if (event.stats.orphanedMutableKeys.length > 0) {
                console.log(`      Orphaned keys:     ${event.stats.orphanedMutableKeys.join(', ')}`);
            }
            break;
        case 'pipeline-done':
            console.log(`\n  ✅  Pipeline complete (${event.totalMs.toFixed(0)}ms total)\n`);
            break;
    }
}
// ── Main ────────────────────────────────────────────────────────────
async function main() {
    const source = process.argv[2] ?? 'https://acme.corp/jobs/senior-platform-engineer';
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║   Dynamic Portfolio Synthesis Pipeline               ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Source:  ${source}`);
    console.log(`  Profile: ${SAMPLE_PROFILE.contactInfo.name}`);
    console.log(`  Jobs:    ${SAMPLE_PROFILE.employmentHistory.length} employment entries`);
    console.log('');
    console.log('─── Pipeline Stages ───────────────────────────────────');
    console.log('');
    // Wire up the orchestrator
    const orchestrator = new DynamicPortfolioOrchestrator({
        extractor: new StubDataExtractor(),
        analyzer: new StubTargetAnalyzer(),
        synthesizer: new StubPortfolioSynthesizer(),
        tailor: new StubExperienceTailor(),
        compiler: new StubDocumentCompiler(),
    }, { stageTimeoutMs: 10_000 });
    // Subscribe to telemetry events
    orchestrator.onEvent(logEvent);
    // Execute the full pipeline
    const compiled = await orchestrator.execute(source, SAMPLE_PROFILE);
    // Parse the output JSON to display the merged portfolio
    const portfolio = JSON.parse(compiled.buffer.toString('utf-8'));
    console.log('─── Compiled Output ───────────────────────────────────');
    console.log(`  Format:   ${compiled.mimeType}`);
    console.log(`  Filename: ${compiled.filename}`);
    console.log(`  Size:     ${compiled.sizeBytes} bytes`);
    console.log('');
    console.log('─── Merged Portfolio ──────────────────────────────────');
    console.log('');
    console.log(`  📝 Summary:`);
    console.log(`     ${portfolio.professionalSummary}`);
    console.log('');
    console.log(`  🎯 Core Competencies:`);
    console.log(`     ${portfolio.coreCompetencies.join(' · ')}`);
    console.log('');
    console.log('  💼 Employment (merged):');
    for (const entry of portfolio.employment) {
        const matchTag = entry.matched ? '✅' : '⚠️  unmatched';
        const dateRange = `${entry.startDate} → ${entry.endDate}`;
        console.log('');
        console.log(`     ${matchTag}  ${entry.companyName}  (${dateRange})`);
        console.log(`         Title: ${entry.tailoredTitle || '(no tailored title)'}`);
        if (entry.highlights.length > 0) {
            for (const bullet of entry.highlights) {
                console.log(`         • ${bullet}`);
            }
        }
        else {
            console.log('         (no tailored highlights)');
        }
    }
    console.log('');
    console.log('  🏆 Tailored Projects:');
    for (const project of portfolio.tailoredProjects) {
        console.log(`     • ${project.name} (relevance: ${(project.relevanceScore * 100).toFixed(0)}%)`);
        console.log(`       ${project.description}`);
        console.log(`       Stack: ${project.techStack.join(', ')}`);
    }
    console.log('');
    console.log('  🎓 Education:');
    for (const edu of portfolio.education) {
        console.log(`     ${edu.degree}, ${edu.institution} (${edu.year})`);
    }
    console.log('');
    console.log('  📜 Certifications:');
    for (const cert of portfolio.certifications) {
        console.log(`     • ${cert}`);
    }
    console.log('');
    console.log('  👤 Contact:');
    for (const [key, value] of Object.entries(portfolio.contactInfo)) {
        console.log(`     ${key}: ${value}`);
    }
    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log('');
}
main().catch((err) => {
    console.error('Pipeline failed:', err);
    process.exit(1);
});
//# sourceMappingURL=demo.js.map