import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyLinkedInImport, importLinkedIn, linkedInDate } from "../lib/import/linkedin/index.mjs";
import { linkedInPdfTextToSource } from "../lib/import/linkedin/pdf.mjs";
import { createLinkedInImport, linkedInImportHistory, linkedInImportStatus, promoteLinkedInImport } from "../server/services/linkedin-import-service.mjs";
import { evidenceBuilderStatus } from "../server/services/evidence-builder-service.mjs";
import { ConfigSchema } from "../config/schema.mjs";

const profile = {
  profile: { name: "Ada Lovelace", headline: "Software Engineer", about: "Builds analytical systems.", location: "London", profileUrl: "https://linkedin.com/in/ada", email: "ada@example.test" },
  experience: [{ company: "Analytical Engines", title: "Engineer", startDate: "Mar 2020", endDate: "Present" }],
  education: [{ school: "University of London", degree: "BSc", fieldOfStudy: "Mathematics", startDate: "2015", endDate: "2019" }],
  certifications: [{ name: "Cloud Certificate", issuingOrganization: "Example", issueDate: "2020-03", credentialUrl: "https://example.test/cert" }],
  publications: [{ title: "Notes", publisher: "Journal", publicationDate: "2021", url: "https://example.test/notes", description: "A paper" }],
  projects: [{ name: "Engine", description: "A calculating engine", startDate: "2022" }],
  languages: [{ language: "English", proficiency: "Native or bilingual proficiency" }],
  volunteerExperience: [{ organization: "Code Club", role: "Mentor", startDate: "2023" }],
  honors: [{ title: "Pioneer", issuer: "Society", date: "2024" }],
  recommendations: [{ recommender: "Charles", role: "Colleague", text: "Excellent collaborator." }],
};

test("imports all supported LinkedIn sections conservatively", () => {
  const report = importLinkedIn(profile, { basics: {}, education: [] });
  for (const section of ["basics", "about", "work", "education", "certificates", "publications", "projects", "languages", "volunteer", "awards", "recommendations"]) assert.ok(report.sections[section], `${section} should be represented`);
  assert.equal(report.records.find((r) => r.section === "work").candidate.startDate, "2020-03");
  assert.equal(report.records.find((r) => r.section === "work").candidate.endDate, undefined);
  assert.equal(report.records.find((r) => r.section === "recommendations").mappingStatus, "supporting_material");
  assert.deepEqual(report.records.find((r) => r.field === "profiles").candidate, { network: "LinkedIn", url: "https://linkedin.com/in/ada" });
  assert.ok(report.records.every((r) => r.id.startsWith("linkedin-")));
});

test("preserves date precision and flags existing profile data for review", () => {
  assert.equal(linkedInDate("2020"), "2020"); assert.equal(linkedInDate("March 2020"), "2020-03"); assert.equal(linkedInDate("Present"), undefined);
  const report = importLinkedIn(profile, { basics: { summary: "Existing", label: "Different" } });
  assert.equal(report.records.find((r) => r.field === "summary").reviewStatus, "conflict");
  assert.equal(report.records.find((r) => r.field === "label").reviewStatus, "conflict");
});

test("LinkedIn profile URLs are reviewable, stable, and preserve unrelated profiles", () => {
  const base = { basics: { profiles: [{ network: "GitHub", url: "https://github.com/ada" }] } };
  const first = importLinkedIn(profile, base);
  const second = importLinkedIn(profile, base);
  const record = first.records.find((item) => item.field === "profiles");
  assert.equal(record.classification, "new");
  assert.equal(record.id, second.records.find((item) => item.field === "profiles").id);
  const applied = applyLinkedInImport(base, first, first.records.filter((item) => item.mappingStatus === "mapped").map((item) => ({ id: item.id, status: "approved" })));
  assert.deepEqual(applied.resume.basics.profiles, [
    { network: "GitHub", url: "https://github.com/ada" },
    { network: "LinkedIn", url: "https://linkedin.com/in/ada" },
  ]);

  const duplicate = importLinkedIn(profile, { basics: { profiles: [{ network: "LinkedIn", url: "https://linkedin.com/in/ada" }] } }).records.find((item) => item.field === "profiles");
  assert.equal(duplicate.classification, "exact_duplicate");
  const conflict = importLinkedIn(profile, { basics: { profiles: [{ network: "LinkedIn", url: "https://linkedin.com/in/different" }] } }).records.find((item) => item.field === "profiles");
  assert.equal(conflict.classification, "conflict");
  assert.ok(conflict.existing);
});

test("section-specific matching distinguishes exact duplicates, possible duplicates, and conflicts", () => {
  const source = {
    education: [{ school: "Example U", degree: "BSc", fieldOfStudy: "CS", startDate: "2018", endDate: "2022" }],
    certifications: [{ name: "Cloud", issuingOrganization: "Vendor", issueDate: "2022" }],
    publications: [{ title: "Paper", publisher: "New Journal", publicationDate: "2024" }],
    projects: [{ name: "Import Tool", description: "New description", startDate: "2024" }],
    languages: [{ language: "English", proficiency: "Native" }],
  };
  const base = {
    education: [{ institution: "Example U", studyType: "BSc", area: "CS", startDate: "2018", endDate: "2021" }],
    certificates: [{ name: "Cloud", issuer: "Vendor", date: "2021" }],
    publications: [{ name: "Paper", publisher: "Old Journal", releaseDate: "2023" }],
    projects: [{ name: "Import Tool", description: "Old description", startDate: "2023" }],
    languages: [{ language: "English", fluency: "Professional" }],
  };
  const records = importLinkedIn(source, base).records;
  for (const section of ["education", "certificates", "languages"]) {
    const record = records.find((item) => item.section === section);
    assert.equal(record.classification, "conflict", section);
    assert.ok(record.existing);
    assert.ok(record.matchReason);
  }
  for (const section of ["publications", "projects"]) {
    const record = records.find((item) => item.section === section);
    assert.equal(record.classification, "possible_duplicate", section);
    assert.ok(record.existing);
    assert.ok(record.matchReason);
  }
  const exact = importLinkedIn({ languages: [{ language: "English", proficiency: "Native" }] }, { languages: [{ language: "English", fluency: "Native" }] }).records[0];
  assert.equal(exact.classification, "exact_duplicate");

  const exactRecords = importLinkedIn({
    education: [{ school: "Example U", degree: "BSc", fieldOfStudy: "CS", startDate: "2018", endDate: "2022" }],
    certifications: [{ name: "Cloud", issuingOrganization: "Vendor", issueDate: "2022", credentialUrl: "https://example.test/cloud" }],
    publications: [{ title: "Paper", publisher: "Journal", publicationDate: "2024", url: "https://example.test/paper" }],
  }, {
    education: [{ institution: "Example U", studyType: "BSc", area: "CS", startDate: "2018", endDate: "2022" }],
    certificates: [{ name: "Cloud", issuer: "Vendor", date: "2022", url: "https://example.test/cloud" }],
    publications: [{ name: "Paper", publisher: "Journal", releaseDate: "2024", url: "https://example.test/paper" }],
  }).records;
  for (const record of exactRecords) assert.equal(record.classification, "exact_duplicate", record.section);
});

test("unsupported dates stay reviewable and possible/conflicting records cannot be promoted", () => {
  const source = { education: [{ school: "Example U", degree: "BSc", fieldOfStudy: "CS", startDate: "Spring 2021" }] };
  const report = importLinkedIn(source, { education: [{ institution: "Example U", studyType: "BSc", area: "CS", startDate: "2021" }] });
  const record = report.records[0];
  assert.equal(record.candidate.startDate, undefined);
  assert.deepEqual(record.dateReview, [{ field: "startDate", sourceDate: "Spring 2021", dateStatus: "review_required" }]);
  assert.equal(record.classification, "possible_duplicate");
  assert.equal(report.status, "review_required");
  const result = applyLinkedInImport({ education: [] }, report, [{ id: record.id, status: "approved" }]);
  assert.equal(result.error, "LINKEDIN_REVIEW_REQUIRED");
});

test("only approved mapped records update the resume and recommendations never do", () => {
  const report = importLinkedIn(profile, { basics: {} });
  const decisions = report.records.filter((r) => r.mappingStatus === "mapped").map((r) => ({ id: r.id, status: "approved" }));
  const result = applyLinkedInImport({ basics: {} }, report, decisions);
  assert.equal(result.resume.basics.summary, "Builds analytical systems.");
  assert.equal(result.resume.education.length, 1);
  assert.equal(result.resume.recommendations, undefined);
});

async function fixtureConfig(resume = { basics: { name: "Existing Candidate" } }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "linkedin-import-"));
  const baseResume = path.join(root, "base.json");
  await fs.writeFile(baseResume, JSON.stringify(resume));
  return {
    root,
    config: { paths: { baseResume, output: path.join(root, "output") } },
    async close() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

test("service persists a review candidate but blocks incomplete review without touching base.json", async () => {
  const fixture = await fixtureConfig();
  try {
    const report = await createLinkedInImport(profile, { config: fixture.config });
    assert.equal((await linkedInImportStatus({ config: fixture.config })).summary.itemsFound, report.summary.itemsFound);
    await assert.rejects(
      () => promoteLinkedInImport([], { config: fixture.config }),
      (error) => error.code === "LINKEDIN_REVIEW_REQUIRED",
    );
    assert.deepEqual(JSON.parse(await fs.readFile(fixture.config.paths.baseResume, "utf8")), { basics: { name: "Existing Candidate" } });
  } finally { await fixture.close(); }
});

test("a new workspace gets default paths and can import before base.json exists", async () => {
  const defaults = ConfigSchema.parse({});
  assert.equal(defaults.paths.output, "output");
  const fixture = await fixtureConfig();
  try {
    await fs.rm(fixture.config.paths.baseResume);
    const report = await createLinkedInImport({ profile: { name: "New Candidate" } }, { config: fixture.config });
    const decisions = report.records.filter((record) => record.mappingStatus === "mapped").map((record) => ({ id: record.id, status: ["conflict", "possible_duplicate"].includes(record.classification) ? "keep_existing" : "approved" }));
    await promoteLinkedInImport(decisions, { config: fixture.config });
    assert.equal(JSON.parse(await fs.readFile(fixture.config.paths.baseResume, "utf8")).basics.name, "New Candidate");
  } finally { await fixture.close(); }
});

test("a new workspace ignores stale evidence review artifacts", async () => {
  const fixture = await fixtureConfig();
  try {
    await fs.rm(fixture.config.paths.baseResume);
    const staleCandidate = path.join(fixture.config.paths.output, "evidence", "evidence-candidate.json");
    await fs.mkdir(path.dirname(staleCandidate), { recursive: true });
    await fs.writeFile(staleCandidate, JSON.stringify({ stale: true }));
    const status = await evidenceBuilderStatus({ config: fixture.config });
    assert.equal(status.candidate, null);
    assert.deepEqual(status.canonical, { version: 2, skills: {}, experiences: [] });
  } finally { await fixture.close(); }
});

test("service atomically applies approved entries and rejects validation failures without replacing base.json", async () => {
  const fixture = await fixtureConfig();
  try {
    const report = await createLinkedInImport(profile, { config: fixture.config });
    const decisions = report.records.filter((record) => record.mappingStatus === "mapped").map((record) => ({ id: record.id, status: ["conflict", "possible_duplicate"].includes(record.classification) ? "keep_existing" : "approved" }));
    const result = await promoteLinkedInImport(decisions, { config: fixture.config });
    assert.equal(result.resume.certificates[0].name, "Cloud Certificate");
    assert.equal(result.resume.recommendations, undefined);
    assert.equal(await linkedInImportStatus({ config: fixture.config }), null, "applied imports must not reappear as pending review after refresh");
    const [audit] = await linkedInImportHistory({ config: fixture.config });
    assert.equal(audit.itemsFound, report.summary.itemsFound);
    assert.equal(audit.applied, decisions.filter((decision) => decision.status === "approved").length);
    assert.equal(audit.skipped, decisions.filter((decision) => decision.status === "keep_existing").length);
    assert.match(audit.appliedAt, /^\d{4}-\d{2}-\d{2}T/u);

    const validationFixture = await fixtureConfig({ basics: {} });
    try {
      const beforeInvalid = await fs.readFile(validationFixture.config.paths.baseResume, "utf8");
      const invalidReport = await createLinkedInImport({ profile: { name: "Ada", email: "not an email" } }, { config: validationFixture.config });
      const invalidDecisions = invalidReport.records.filter((record) => record.mappingStatus === "mapped").map((record) => ({ id: record.id, status: "approved" }));
      await assert.rejects(() => promoteLinkedInImport(invalidDecisions, { config: validationFixture.config }), (error) => error.code === "LINKEDIN_RESUME_INVALID");
      assert.equal(await fs.readFile(validationFixture.config.paths.baseResume, "utf8"), beforeInvalid);
    } finally { await validationFixture.close(); }
  } finally { await fixture.close(); }
});

test("LinkedIn PDF import UI uses sectioned review cards without exposing parser JSON", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.equal(html.includes("linkedin-import-pdf"), true);
  assert.equal(html.includes("Import LinkedIn Profile"), true);
  assert.equal(html.includes("linkedin-profile-url"), false);
  for (const token of ["renderLinkedInReview", "loadLinkedInImportHistory", "Current resume", "Imported value", "data-linkedin-tab", "data-linkedin-include", "Apply selected items to resume", "Imported data and experiences are updated", "Import ready for review", "Include in resume", "lg:col-span-2", "whitespace-pre-wrap", "leading-snug break-words"]) assert.equal(app.includes(token), true, `missing ${token}`);
  assert.equal(app.includes('text-sm truncate'), false, "long imported titles must wrap instead of being truncated");
  assert.equal(app.includes('item.section === "publications" && key === "name"'), true, "publication names must not be repeated below their title");
  assert.equal(app.includes("Ocultar dados extraídos"), false, "extracted data must follow the title without an interrupting disclosure control");
  assert.equal(app.includes("<details open"), false, "review cards must not hide extracted values behind details controls");
  const evidenceNavigation = app.slice(app.indexOf('if (target === "evidence")'), app.indexOf('if (target === "history")'));
  assert.equal(evidenceNavigation.includes("loadEvidenceBuilder()"), false, "entering the evidence view must not automatically open the advanced review");
  assert.equal(evidenceNavigation.includes("refreshEvidenceReviewAvailability()"), true, "a pending review should be offered as an explicit action");
  assert.equal(app.includes('$("#evidence-builder-container")?.classList.add("hidden")'), true, "applying an import must dismiss any stale advanced review");
  assert.equal(html.includes("Master Career Profile"), true, "the career area must use a user-facing profile mental model");
  assert.equal(html.includes('id="view-home"'), true, "first-time users must have a goal-oriented home view");
  assert.equal(html.includes("Tailor a CV"), true, "the main navigation must name the user outcome");
  assert.equal(app.includes("function renderHome()"), true, "home must explain the next best action from profile progress");
  assert.equal(app.includes("Review your Master Career Profile"), true, "the confirmation flow must use user-facing language");
  assert.equal(app.includes("Confirm Master Career Profile"), true, "the final action must describe the user outcome");
  assert.equal(app.includes("Imported from your resume"), true, "imported roles must not be presented as read-only");
  assert.equal(app.includes("btn-complete-role"), true, "each imported role must offer a way to add context");
  assert.equal(app.includes("questionsByContext"), true, "follow-up questions must be grouped by role");
  assert.equal(app.includes("Evidence Builder Review"), false, "internal review terminology must not be shown to users");
  assert.equal(app.includes("Promote approved evidence"), false, "internal promotion terminology must not be shown to users");
});

test("PDF text parser maps only explicitly headed LinkedIn sections", () => {
  const source = linkedInPdfTextToSource(`Ada Lovelace\nSoftware Engineer\n\nAbout\nBuilds analytical systems.\n\nEducation\nUniversity of London\nBachelor of Science, Mathematics\n2015 - 2019\n\nLanguages\nEnglish, Portuguese\n\nRecommendations\nCharles Babbage\nExcellent collaborator.`, { profileUrl: "https://linkedin.com/in/ada" });
  assert.equal(source.profile.name, "Ada Lovelace");
  assert.equal(source.profile.profileUrl, "https://linkedin.com/in/ada");
  assert.equal(source.education[0].school, "University of London");
  assert.deepEqual(source.languages, [{ language: "English" }, { language: "Portuguese" }]);
  assert.equal(source.recommendations[0].text, "Excellent collaborator.");
});

test("PDF parser never promotes contact labels or description bullets to profile and work records", () => {
  const source = linkedInPdfTextToSource(`Contact\ncdessana@gmail.com\n\nExperience\nSenior Full Stack Engineer\nInstituto de Pesquisas Eldorado\nJune 2020 - Present\n• Design, develop, and maintain cloud-native backend services using Kotlin.\n\n• Design, develop, and maintain cloud-native backend services using Kotlin.\nJava, Spring Boot, Python, and Google Cloud Platform.\n\nEducation\nUniversity Example\nBachelor of Science\nComputer Science`);
  assert.equal(source.profile.name, undefined);
  assert.equal(source.profile.email, "cdessana@gmail.com");
  assert.deepEqual(source.experience, [{ title: "Senior Full Stack Engineer", company: "Instituto de Pesquisas Eldorado", startDate: "June 2020", highlights: ["Design, develop, and maintain cloud-native backend services using Kotlin.", "Design, develop, and maintain cloud-native backend services using Kotlin. Java, Spring Boot, Python, and Google Cloud Platform."] }]);
});

test("PDF parser reports a detected section when it cannot confirm any record", () => {
  const source = linkedInPdfTextToSource("Carmina Nascimento\nExperience\nOnly an ambiguous description without identity or dates");
  assert.deepEqual(source.__diagnostics.emptyDetectedSections, ["experience"]);
  assert.equal(importLinkedIn(source, {}).status, "review_required");
});

test("PDF parser extracts multiple employments and every supported profile section", () => {
  const source = linkedInPdfTextToSource(`Carmina Nascimento
Senior Software Engineer
cdessana@gmail.com
About
Backend engineer focused on distributed systems.
Experience
Instituto de Pesquisas Eldorado
Senior Full Stack Engineer
June 2020 - Present · 5 years
• Built cloud-native backend services.
Sidia Instituto de Ciência e Tecnologia
Full Stack Engineer
September 2018 - May 2020
• Developed embedded software systems.
Education
PUC Minas
Master of Business Administration, DevOps & Continuous Software Engineering
April 2025 - December 2026
Licenses & Certifications
Cloud Architecture
Example Institute
March 2024
Publications
Reliable Distributed Systems
Example Journal
2023
Projects
Career Evidence Tool
Local-first resume tooling
Languages
Portuguese, English
Volunteer Experience
Code Club
Mentor
January 2022 - Present
Honors & Awards
Engineering Excellence
Example Institute
2024
Recommendations
Grace Hopper
Excellent collaborator.`);
  assert.equal(source.experience.length, 2);
  assert.deepEqual(source.experience.map(({ company, title }) => ({ company, title })), [
    { company: "Instituto de Pesquisas Eldorado", title: "Senior Full Stack Engineer" },
    { company: "Sidia Instituto de Ciência e Tecnologia", title: "Full Stack Engineer" },
  ]);
  for (const section of ["education", "certifications", "publications", "projects", "languages", "volunteerExperience", "honors", "recommendations"]) assert.ok(source[section].length, `${section} should be extracted`);
  assert.equal(source.education[0].school, "PUC Minas");
  assert.equal(source.education[0].fieldOfStudy, "DevOps & Continuous Software Engineering");
});

test("PDF parser keeps LinkedIn sidebar sections separate and preserves nested roles", () => {
  const source = linkedInPdfTextToSource(`Contact
candidate@example.com
www.linkedin.com/in/candidate-
name (LinkedIn)
Top Skills
C++
SQL
.NET Core
Languages
English (Full Professional)
Spanish (Elementary)
Certifications
React Nanodegree
Generative AI: Prompt Engineering
Basics
Certified Tester, Foundation Level
(CTFL)
Publications
First research publication with a
wrapped title
Second Research Publication
Carmina Nascimento
Senior Software Engineer | Backend & Distributed Systems
Amazonas, Brazil
Summary
Backend engineer focused on maintainable distributed systems.
Experience
VTinova
1 year 2 months
Junior Development Analyst
June 2014 - October 2014
Manaus Area, Brazil
• Developed and maintained embedded software systems.
Software Intern
September 2013 - June 2014
Greater Manaus
• Designed test plans and specified detailed test cases.
• Executed manual and automated tests, reporting defects.
Nokia Institute of Technology
Software Intern
April 2012 - August 2012
Manaus, Amazonas, Brazil
• Supported the development lifecycle of engineering projects.
Education
PUC Minas
Master of Business Administration, DevOps & Continuous Software Engineering
April 2025 - December 2026`);

  assert.deepEqual(source.profile, {
    email: "candidate@example.com",
    profileUrl: "https://www.linkedin.com/in/candidate-name",
    name: "Carmina Nascimento",
    headline: "Senior Software Engineer | Backend & Distributed Systems",
    location: "Amazonas, Brazil",
    about: "Backend engineer focused on maintainable distributed systems.",
  });
  assert.deepEqual(source.skills.map((item) => item.name), ["C++", "SQL", ".NET Core"]);
  assert.deepEqual(source.languages, [
    { language: "English", proficiency: "Full Professional" },
    { language: "Spanish", proficiency: "Elementary" },
  ]);
  assert.deepEqual(source.certifications.map((item) => item.name), ["React Nanodegree", "Generative AI: Prompt Engineering Basics", "Certified Tester, Foundation Level (CTFL)"]);
  assert.deepEqual(source.publications.map((item) => item.title), ["First research publication with a wrapped title", "Second Research Publication"]);
  assert.deepEqual(source.experience.map(({ company, title, location, highlights }) => ({ company, title, location, highlights })), [
    { company: "VTinova", title: "Junior Development Analyst", location: "Manaus Area, Brazil", highlights: ["Developed and maintained embedded software systems."] },
    { company: "VTinova", title: "Software Intern", location: "Greater Manaus", highlights: ["Designed test plans and specified detailed test cases.", "Executed manual and automated tests, reporting defects."] },
    { company: "Nokia Institute of Technology", title: "Software Intern", location: "Manaus, Amazonas, Brazil", highlights: ["Supported the development lifecycle of engineering projects."] },
  ]);
});
