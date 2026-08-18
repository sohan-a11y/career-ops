/**
 * Tests for load-immutable-profile.ts — plain node:assert, no framework,
 * matching the rest of career-ops's *.test.mjs convention (see
 * discover-ats.test.mjs). Run after `npm run build`:
 *   node dist/profile/load-immutable-profile.test.js
 */

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractSection,
  parseExperienceEntries,
  splitDateRange,
  buildEmploymentHistory,
  assignCompanyIds,
  extractRawBulletsByCompanyId,
  parseEducationAndCertifications,
  buildContactInfo,
  loadImmutableProfile,
  ProfileLoadError,
} from './load-immutable-profile.js';

let pass = 0;
let fail = 0;

function check(cond: boolean, label: string): void {
  if (cond) { pass++; } else { fail++; console.error(`  FAIL: ${label}`); }
}

// ── extractSection ──────────────────────────────────────────────────
{
  const md = '# Name\n\n## Summary\nHello\n\n## Experience\n### Title\nBody\n\n## Education\nMore';
  const exp = extractSection(md, /^##\s+Experience\s*$/i);
  check(exp.includes('### Title') && exp.includes('Body') && !exp.includes('Education'), 'extractSection isolates the Experience block');

  const missing = extractSection(md, /^##\s+NoSuchSection\s*$/i);
  check(missing === '', 'extractSection returns empty string when heading absent');
}

// ── parseExperienceEntries ──────────────────────────────────────────
{
  const section = [
    '### Software Developer — AI/ML Engineer',
    '**Tata Consultancy Services** — Client: DaVita Healthcare · Hyderabad, India',
    '*Dec 2024 – Aug 2026* (also: Systems Engineer Trainee, Jul – Dec 2024)',
    '',
    '- bullet one',
    '- bullet two',
    '',
    '### Independent AI/ML Consultant',
    '**Freelance** — Hyderabad, India',
    '*Dec 2025 – Aug 2026*',
    '',
    '- bullet three',
  ].join('\n');

  const entries = parseExperienceEntries(section);
  check(entries.length === 2, 'parseExperienceEntries finds two roles');
  check(entries[0]?.title === 'Software Developer — AI/ML Engineer', 'first entry title parsed');
  check(entries[0]?.company === 'Tata Consultancy Services', 'first entry company parsed (bold line, ignores trailing client note)');
  check(entries[0]?.dates.startsWith('Dec 2024') ?? false, 'first entry dates captured with parenthetical suffix intact');
  check(entries[1]?.company === 'Freelance', 'second entry company parsed');
  check(entries[0]?.bullets.length === 2 && entries[0]?.bullets[0] === 'bullet one', 'first entry bullets captured verbatim');
  check(entries[1]?.bullets.length === 1 && entries[1]?.bullets[0] === 'bullet three', 'second entry bullets do not leak from the first');
}

// ── assignCompanyIds / extractRawBulletsByCompanyId ─────────────────
{
  const entries = [
    { title: 'Engineer', company: 'Acme Corp', dates: 'Jan 2020 – Dec 2021', bullets: ['did X', 'did Y'] },
    { title: 'Senior Engineer', company: 'Acme Corp', dates: 'Jan 2022 – Present', bullets: ['did Z'] },
  ];
  const withIds = assignCompanyIds(entries);
  check(withIds[0]?.companyId === 'acme-corp' && withIds[1]?.companyId === 'acme-corp-2', 'assignCompanyIds matches buildEmploymentHistory\'s own scheme');

  const history = buildEmploymentHistory(entries);
  const bulletsByCompanyId = extractRawBulletsByCompanyId(entries);
  check(
    history.every((h) => bulletsByCompanyId.has(h.companyId)),
    'every companyId in employmentHistory has a matching entry in extractRawBulletsByCompanyId — the merge join can never silently drop one',
  );
  check(
    JSON.stringify(bulletsByCompanyId.get('acme-corp')) === JSON.stringify(['did X', 'did Y']),
    'extractRawBulletsByCompanyId returns the exact source bullets, unmodified',
  );
}

// ── splitDateRange ───────────────────────────────────────────────────
{
  check(JSON.stringify(splitDateRange('Dec 2024 – Aug 2026')) === JSON.stringify({ startDate: 'Dec 2024', endDate: 'Aug 2026' }), 'splitDateRange en-dash');
  check(JSON.stringify(splitDateRange('2019-06 - 2022-02')) === JSON.stringify({ startDate: '2019-06', endDate: '2022-02' }), 'splitDateRange hyphen');
  check(splitDateRange('Mar 2022 – Present').endDate === 'present', 'splitDateRange normalizes "Present" to lowercase sentinel');
  check(splitDateRange('Jan 2020 to Current').endDate === 'present', 'splitDateRange normalizes "Current" via "to" separator');
  check(splitDateRange('Dec 2024 – Aug 2026 (also: Trainee, Jul – Dec 2024)').endDate === 'Aug 2026', 'splitDateRange strips trailing parenthetical before splitting');
}

// ── buildEmploymentHistory ──────────────────────────────────────────
{
  const entries = [
    { title: 'Engineer', company: 'Acme Corp', dates: 'Jan 2020 – Dec 2021', bullets: [] },
    { title: 'Senior Engineer', company: 'Acme Corp', dates: 'Jan 2022 – Present', bullets: [] },
    { title: 'Intern', company: 'Other Co', dates: 'Jun 2019 – Aug 2019', bullets: [] },
  ];
  const history = buildEmploymentHistory(entries);
  check(history.length === 3, 'buildEmploymentHistory preserves entry count');
  check(history[0]?.companyId === 'acme-corp', 'first Acme Corp entry gets the base slug');
  check(history[1]?.companyId === 'acme-corp-2', 'second Acme Corp entry gets a disambiguated slug (no collision)');
  check(history[2]?.companyId === 'other-co', 'distinct company gets its own slug');
  check(history[1]?.endDate === 'present', 'buildEmploymentHistory normalizes present-tense dates');
  check(history[0]?.companyName === 'Acme Corp', 'companyName passes through verbatim');
}

// ── parseEducationAndCertifications ─────────────────────────────────
{
  const md = [
    '## Education & Certifications',
    '',
    '**B.Tech, Computer Science** — MGIT, JNTUH, Hyderabad · 2020 – 2024',
    '',
    '**Certifications:**',
    '- Google Associate Cloud Engineer (2024)',
    '- Oracle Generative AI Professional (2024)',
    '',
    '## Publications',
    'unrelated text',
  ].join('\n');

  const { education, certifications } = parseEducationAndCertifications(md);
  check(certifications.length === 2, 'parseEducationAndCertifications finds two certifications');
  check(certifications[0] === 'Google Associate Cloud Engineer (2024)', 'certification text captured verbatim');
  check(education.length === 1, 'parseEducationAndCertifications finds one education entry');
  check((education[0] as { degree: string }).degree === 'B.Tech, Computer Science', 'education degree parsed');
  check(!certifications.some((c) => c.includes('unrelated')), 'parseEducationAndCertifications stops at the next ## heading');
}

// ── buildContactInfo ─────────────────────────────────────────────────
{
  const info = buildContactInfo({ full_name: 'Jane Doe', email: 'jane@example.com', phone: '', linkedin: 'linkedin.com/in/jane' });
  check(info.name === 'Jane Doe', 'buildContactInfo maps full_name to name');
  check(info.email === 'jane@example.com', 'buildContactInfo maps email');
  check(!('phone' in info), 'buildContactInfo omits blank fields rather than emitting empty strings');
  check(info.linkedin === 'linkedin.com/in/jane', 'buildContactInfo maps linkedin');
  check(JSON.stringify(buildContactInfo(undefined)) === '{}', 'buildContactInfo handles a missing candidate block');
}

// ── loadImmutableProfile — full integration against real files on disk ──
{
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-profile-test-'));
  const cvPath = join(dir, 'cv.md');
  const profilePath = join(dir, 'profile.yml');

  writeFileSync(cvPath, [
    '# Test Candidate',
    '',
    '## Experience',
    '',
    '### Backend Engineer',
    '**Widget Co** — Remote',
    '*Jan 2021 – Present*',
    '',
    '- Did a thing',
    '',
    '## Education & Certifications',
    '',
    '**B.S. Computer Science** — State University · 2017 – 2021',
    '',
    '**Certifications:**',
    '- AWS Certified Developer (2022)',
  ].join('\n'));

  writeFileSync(profilePath, [
    'candidate:',
    '  full_name: "Test Candidate"',
    '  email: "test@example.com"',
    '  location: "Remote"',
  ].join('\n'));

  const profile = loadImmutableProfile({ cvPath, profileYamlPath: profilePath });
  check(profile.contactInfo.name === 'Test Candidate', 'loadImmutableProfile: contactInfo.name from real profile.yml');
  check(profile.employmentHistory.length === 1, 'loadImmutableProfile: one employment entry from real cv.md');
  check(profile.employmentHistory[0]?.companyId === 'widget-co', 'loadImmutableProfile: derived companyId');
  check(profile.employmentHistory[0]?.endDate === 'present', 'loadImmutableProfile: present-tense role normalized');
  check(profile.certifications.length === 1 && profile.certifications[0] === 'AWS Certified Developer (2022)', 'loadImmutableProfile: certifications parsed');
  check(Object.isFrozen(profile), 'loadImmutableProfile: returned profile is frozen (immutable in fact, not just in name)');
  check(Object.isFrozen(profile.employmentHistory), 'loadImmutableProfile: employmentHistory array is frozen');

  // Missing files throw ProfileLoadError, not a generic fs error.
  let threw = false;
  try {
    loadImmutableProfile({ cvPath: join(dir, 'does-not-exist.md'), profileYamlPath: profilePath });
  } catch (err) {
    threw = err instanceof ProfileLoadError;
  }
  check(threw, 'loadImmutableProfile throws ProfileLoadError for a missing cv.md');

  rmSync(dir, { recursive: true, force: true });
}

// ── loadImmutableProfile — against the REAL project cv.md + profile.yml ──
{
  // Derived from this file's own location, NOT process.cwd() — this
  // compiled test lives at career-ops/synthesis/dist/profile/, so
  // career-ops root is three levels up.
  const careerOpsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const realCvPath = join(careerOpsRoot, 'cv.md');
  const realProfilePath = join(careerOpsRoot, 'config', 'profile.yml');
  try {
    const profile = loadImmutableProfile({ cvPath: realCvPath, profileYamlPath: realProfilePath });
    check(profile.employmentHistory.length >= 2, `real cv.md: parsed ${profile.employmentHistory.length} employment entries (expected >= 2)`);
    const tcs = profile.employmentHistory.find((e) => e.companyName.includes('Tata Consultancy'));
    check(tcs !== undefined, 'real cv.md: TCS entry present with exact company name');
    // The real cv.md literally writes "Aug 2026" as the end date (not
    // "Present") for both current roles — preserved verbatim per the
    // no-fabrication rule, so the parser must NOT silently rewrite it.
    check(tcs?.endDate === 'Aug 2026', `real cv.md: TCS end date preserved verbatim as written (got "${tcs?.endDate}")`);
    check(tcs?.startDate === 'Dec 2024', `real cv.md: TCS start date parsed correctly (got "${tcs?.startDate}")`);
    check(profile.certifications.length >= 1, 'real cv.md: certifications parsed');
    check(profile.contactInfo.email === 'kalyaankummer@gmail.com', 'real profile.yml: contact email matches exactly');
    console.log(`  (real-file check: ${profile.employmentHistory.length} roles, ${profile.certifications.length} certifications parsed from the actual project files)`);
  } catch (err) {
    fail++;
    console.error(`  FAIL: could not load the real project cv.md/profile.yml — ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\n  load-immutable-profile self-test: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
