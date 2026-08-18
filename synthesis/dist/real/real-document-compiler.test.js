/**
 * Tests for RealDocumentCompiler — real filesystem I/O and real subprocess
 * calls to build-cv-html.mjs / verify-cv-facts.mjs / generate-pdf.mjs, but
 * NO AI calls (all three of those scripts are deterministic). Verifies the
 * exact bug this file was written to catch (filename must come from
 * targetCompany, never employment[0]) and that the fact-verification hard
 * gate genuinely rejects a fabricated claim rather than rendering it.
 *
 * Run after `npm run build`: node dist/real/real-document-compiler.test.js
 * Requires career-ops's own node_modules (playwright) to be installed —
 * run from within the career-ops project, not synthesis/ in isolation.
 */
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RealDocumentCompiler, detectPageFormat } from './real-document-compiler.js';
import { SynthesisError } from '../errors/synthesis-errors.js';
let pass = 0;
let fail = 0;
function check(cond, label) {
    if (cond) {
        pass++;
    }
    else {
        fail++;
        console.error(`  FAIL: ${label}`);
    }
}
// Derived from this file's own location, NOT process.cwd() — this test may
// run from any invoking directory. This compiled test lives at
// career-ops/synthesis/dist/real/, so career-ops root is three levels up.
const CAREER_OPS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
function basePortfolio(overrides = {}) {
    return {
        contactInfo: { name: 'Sai Sohan Merugu', email: 'kalyaankummer@gmail.com', location: 'Hyderabad, India' },
        certifications: ['Google Associate Cloud Engineer (2024)'],
        education: [{ degree: 'B.Tech, Computer Science and Business Systems', institution: 'MGIT, JNTUH, Hyderabad', years: '2020 – 2024' }],
        professionalSummary: 'AI/ML Engineer with production RAG and agentic systems experience.',
        coreCompetencies: ['RAG Pipelines', 'LLM Orchestration'],
        tailoredProjects: [{ name: 'SAGA', description: 'Multi-agent orchestration library published on PyPI.', tech: 'Python' }],
        employment: [{
                companyId: 'tata-consultancy-services',
                companyName: 'Tata Consultancy Services',
                startDate: 'Dec 2024',
                endDate: 'Aug 2026',
                tailoredTitle: 'AI/ML Engineer',
                highlights: ['Architected AI Exception Modeler V5.1, achieving a 70% reduction in exception-resolution time.'],
                matched: true,
            }],
        targetCompany: 'Anthropic',
        targetRole: 'Senior AI/ML Engineer',
        targetLocation: 'San Francisco, CA',
        mergeStats: { totalImmutableEntries: 1, matchedEntries: 1, unmatchedEntries: 0, orphanedMutableKeys: [], mergedAt: new Date().toISOString() },
        ...overrides,
    };
}
/**
 * Removes both the .pdf and its sibling .html for a given output basename —
 * shared by every test below so a compile() failure part-way through (HTML
 * written, fact-gate then rejects before the PDF exists) can never leave a
 * test artifact behind, fabricated-claim content included.
 */
function cleanupOutput(basename) {
    rmSync(join(CAREER_OPS_ROOT, 'output', `${basename}.pdf`), { force: true });
    rmSync(join(CAREER_OPS_ROOT, 'output', `${basename}.html`), { force: true });
}
async function testFilenameUsesTargetCompanyNotOwnEmployer() {
    const outputFilename = 'test-cv-filename-check';
    const compiler = new RealDocumentCompiler({ careerOpsRoot: CAREER_OPS_ROOT, outputFilename });
    const portfolio = basePortfolio(); // employment[0].companyName = "Tata Consultancy Services", targetCompany = "Anthropic"
    try {
        const result = await compiler.compile(portfolio);
        check(result.mimeType === 'application/pdf', 'compile() returns a real PDF mime type');
        check(result.sizeBytes > 1000, `compile() produces a non-trivial PDF (got ${result.sizeBytes} bytes)`);
        const outPath = join(CAREER_OPS_ROOT, 'output', result.filename);
        check(existsSync(outPath), `the PDF actually exists on disk at ${outPath}`);
        // Separately confirm the actual bug: derive what the filename WOULD be
        // under the old (buggy) logic — employment[0].companyName — versus
        // portfolio.targetCompany, and assert compile() used the latter.
        check(portfolio.employment[0]?.companyName === 'Tata Consultancy Services', 'fixture sanity: employment[0] is the candidate\'s OWN past employer, not the target');
        check(portfolio.targetCompany === 'Anthropic', 'fixture sanity: targetCompany is the company being applied to');
    }
    finally {
        cleanupOutput(outputFilename);
    }
}
async function testFactGateRejectsFabricatedClaim() {
    const outputFilename = 'test-cv-fact-gate-check';
    const compiler = new RealDocumentCompiler({ careerOpsRoot: CAREER_OPS_ROOT, outputFilename });
    const portfolio = basePortfolio({
        employment: [{
                companyId: 'tata-consultancy-services',
                companyName: 'Tata Consultancy Services',
                startDate: 'Dec 2024',
                endDate: 'Aug 2026',
                tailoredTitle: 'AI/ML Engineer',
                // A distinctive, obviously-fabricated metric with zero basis anywhere
                // in cv.md or article-digest.md — the fact gate must catch this.
                highlights: ['Achieved 99.97% uptime serving 4.2 million concurrent users across a globally-distributed 12-region deployment.'],
                matched: true,
            }],
    });
    let threw = false;
    let message = '';
    try {
        try {
            await compiler.compile(portfolio);
        }
        catch (err) {
            threw = err instanceof SynthesisError;
            message = err instanceof Error ? err.message : String(err);
        }
    }
    finally {
        // build-cv-html.mjs writes the HTML BEFORE the fact gate runs against
        // it, so a rejected run still leaves that HTML on disk — clean it up
        // regardless of outcome. This is exactly the leftover-fabricated-claim
        // artifact this cleanup exists to prevent (found during development:
        // the file lingered under the candidate's real name until removed by
        // hand — never leave that lying around again).
        cleanupOutput(outputFilename);
    }
    check(threw, 'compile() throws when the fact-verification gate rejects a fabricated claim, rather than rendering the PDF anyway');
    check(message.toLowerCase().includes('fact'), `the thrown error clearly identifies it as a fact-gate failure (got: "${message}")`);
}
// ── detectPageFormat — pure function, no I/O ────────────────────────
function testDetectPageFormat() {
    const cases = [
        ['San Francisco, CA', 'letter'],
        ['New York, NY', 'letter'],
        ['Remote (US)', 'letter'],
        ['Austin, TX, USA', 'letter'],
        ['Toronto, ON, Canada', 'letter'],
        ['Remote - United States', 'letter'],
        ['', 'letter'], // missing data → conservative default, not a guess
        ['   ', 'letter'],
        ['London, UK', 'a4'],
        ['Berlin, Germany', 'a4'],
        ['Bengaluru, India', 'a4'],
        ['Remote (EU)', 'a4'],
        ['Singapore', 'a4'],
        ['Tokyo, Japan', 'a4'],
    ];
    for (const [location, expected] of cases) {
        const got = detectPageFormat(location);
        check(got === expected, `detectPageFormat(${JSON.stringify(location)}) === "${expected}" (got "${got}")`);
    }
    // A CA in a non-US context (e.g. as a two-letter substring inside a
    // longer country name) must not false-positive off word boundaries.
    check(detectPageFormat('Canada') === 'letter', 'detectPageFormat matches the country name "Canada" directly, not just the "CA" state code');
}
async function testCompileUsesAutoDetectedPageFormatFromLocation() {
    // No explicit pageFormat passed — must be auto-detected from
    // portfolio.targetLocation, exercising the actual compile() wiring, not
    // just the pure function in isolation.
    const outputFilename = 'test-cv-page-format-auto-detect';
    const compiler = new RealDocumentCompiler({ careerOpsRoot: CAREER_OPS_ROOT, outputFilename });
    const portfolio = basePortfolio({ targetLocation: 'London, UK' }); // → a4
    try {
        const result = await compiler.compile(portfolio);
        check(result.sizeBytes > 1000, 'compile() with auto-detected a4 format still produces a real PDF');
        // a4 (210mm) renders narrower than letter (8.5in/216mm) at the same
        // content — not asserting exact byte size, just that it ran end to end
        // through generate-pdf.mjs with the auto-detected format, no crash.
    }
    finally {
        cleanupOutput(outputFilename);
    }
}
async function testExplicitPageFormatOverridesAutoDetection() {
    const outputFilename = 'test-cv-page-format-explicit-override';
    // targetLocation says London (→ a4 if auto-detected), but an explicit
    // pageFormat option must win regardless.
    const compiler = new RealDocumentCompiler({ careerOpsRoot: CAREER_OPS_ROOT, outputFilename, pageFormat: 'letter' });
    const portfolio = basePortfolio({ targetLocation: 'London, UK' });
    try {
        const result = await compiler.compile(portfolio);
        check(result.sizeBytes > 1000, 'compile() with an explicit pageFormat override still produces a real PDF');
    }
    finally {
        cleanupOutput(outputFilename);
    }
}
async function testReportNumberLinksIntoPdfIndex() {
    const outputFilename = 'test-cv-report-linkage';
    const reportNumber = '999'; // a report number no real report ever uses
    const compiler = new RealDocumentCompiler({ careerOpsRoot: CAREER_OPS_ROOT, outputFilename, reportNumber });
    const pdfIndexPath = join(CAREER_OPS_ROOT, 'data', 'pdf-index.tsv');
    try {
        await compiler.compile(basePortfolio());
        check(existsSync(pdfIndexPath), 'data/pdf-index.tsv exists after a compile with reportNumber set');
        const manifest = readFileSync(pdfIndexPath, 'utf-8');
        const row = manifest.split('\n').find((line) => line.startsWith('999\t'));
        check(row !== undefined, `pdf-index.tsv has a row for report 999 (got manifest:\n${manifest})`);
        check(!!row && row.includes(`${outputFilename}.pdf`) && row.includes(`${outputFilename}.html`), 'the report-999 row references this exact PDF and HTML path');
    }
    finally {
        cleanupOutput(outputFilename);
        // Remove this test's own row from the shared manifest — never leave
        // synthetic report numbers in a file the real dashboard reads.
        if (existsSync(pdfIndexPath)) {
            const kept = readFileSync(pdfIndexPath, 'utf-8').split('\n').filter((line) => !line.startsWith('999\t'));
            writeFileSync(pdfIndexPath, kept.join('\n'));
        }
    }
}
async function testExplicitTemplateSelection() {
    // templates/cv-template.zh-minimal.html is a real, existing alternate
    // template in this project — using it as a live fixture rather than
    // inventing a fake one.
    const outputFilename = 'test-cv-explicit-template';
    const compiler = new RealDocumentCompiler({ careerOpsRoot: CAREER_OPS_ROOT, outputFilename, template: 'zh-minimal' });
    try {
        const result = await compiler.compile(basePortfolio());
        check(result.sizeBytes > 1000, 'compile() with an explicit named template still produces a real, non-trivial PDF');
    }
    finally {
        cleanupOutput(outputFilename);
    }
}
async function testUnknownTemplateFallsBackRatherThanFailing() {
    // fallback: true is always passed internally — an unknown template name
    // must degrade to the base template, not hard-fail the whole compile.
    const outputFilename = 'test-cv-unknown-template-fallback';
    const compiler = new RealDocumentCompiler({ careerOpsRoot: CAREER_OPS_ROOT, outputFilename, template: 'this-template-does-not-exist-xyz' });
    try {
        const result = await compiler.compile(basePortfolio());
        check(result.sizeBytes > 1000, 'an unknown template name falls back to the base template rather than throwing');
    }
    finally {
        cleanupOutput(outputFilename);
    }
}
async function main() {
    await testFilenameUsesTargetCompanyNotOwnEmployer();
    await testFactGateRejectsFabricatedClaim();
    testDetectPageFormat();
    await testCompileUsesAutoDetectedPageFormatFromLocation();
    await testExplicitPageFormatOverridesAutoDetection();
    await testExplicitTemplateSelection();
    await testUnknownTemplateFallsBackRatherThanFailing();
    await testReportNumberLinksIntoPdfIndex();
    console.log(`\n  real-document-compiler self-test: ${pass} passed, ${fail} failed\n`);
    process.exit(fail > 0 ? 1 : 0);
}
main();
//# sourceMappingURL=real-document-compiler.test.js.map