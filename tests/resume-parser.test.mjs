import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseResumeDocument, parseResumeText } from "../lib/resume-parser/parse.mjs";
import { readResumeSource } from "../lib/resume-parser/read-source.mjs";
import { parseArguments, runResumeParser } from "../scripts/resume-parser.mjs";
import { extractedEntry, provenanceForEntry } from "../lib/resume-parser/extracted-entry.mjs";
import { extractEducationEntries } from "../lib/resume-parser/education.mjs";
import { sectionLines } from "../lib/resume-parser/source-lines.mjs";
import { extractBasicsEntry } from "../lib/resume-parser/basics.mjs";
import { findEntryConflicts } from "../lib/resume-parser/conflicts.mjs";
import { inspectDateRange, parseDateRange } from "../lib/resume-parser/dates.mjs";

const resumeText = `# Jane Doe
Senior Software Engineer
jane@example.com | +1 555 123 4567 | https://www.linkedin.com/in/janedoe

## Experience
Example Corp | Backend Engineer | 2021-04 - 2023-06
- Built REST APIs using Node.js and PostgreSQL.
Other Corp | Software Engineer | 2019 - 2021
- Participated in architecture discussions.

## Education
Example University | Bachelor of Science | 2015 - 2019

## Skills
Backend: Node.js, PostgreSQL

## Certificates
React Nanodegree — Udacity

## Languages
English — Fluent`;

test("parses explicit TXT resume facts without strengthening claims", () => {
  const { resume, report } = parseResumeText(resumeText);
  assert.equal(report.status, "ready");
  assert.equal(resume.basics.name, "Jane Doe");
  assert.equal(resume.work[0].startDate, "2021-04");
  assert.equal(resume.work[0].endDate, "2023-06");
  assert.deepEqual(resume.work[1].highlights, ["Participated in architecture discussions."]);
  assert.deepEqual(resume.skills[0].keywords, ["Node.js", "PostgreSQL"]);
  assert.equal(resume.certificates[0].name, "React Nanodegree");
});

test("reports ambiguous work text rather than assigning it to a role", () => {
  const { resume, report } = parseResumeText("Jane Doe\n\n## Experience\nWorked with messaging systems.");
  assert.equal(resume.work, undefined);
  assert.equal(report.status, "review_required");
  assert.equal(report.issues[0].code, "ambiguous_work_entry");
});

test("extracts separate company, role, date, and bullet lines without mixing blocks", () => {
  const { resume, report } = parseResumeText(`Jane Doe
## Experience
Senior Software Engineer
Example Corp
Mar 2021 — Present
• Built APIs using Node.js.
Data Analyst
Other Corp
03/2019 - 2021
• Built dashboards.`);
  assert.equal(report.status, "ready");
  assert.deepEqual(resume.work.map(({ name, position, startDate, endDate }) => ({ name, position, startDate, endDate })), [
    { name: "Example Corp", position: "Senior Software Engineer", startDate: "2021-03", endDate: undefined },
    { name: "Other Corp", position: "Data Analyst", startDate: "2019-03", endDate: "2021" },
  ]);
  assert.deepEqual(resume.work[0].highlights, ["Built APIs using Node.js."]);
});

test("extracts multi-line education and keeps certificates distinct from skills", () => {
  const { resume, report } = parseResumeText(`Jane Doe
## Education
Master of Science in Computer Science
Example University
2020 - 2022
## Certificates
React Nanodegree — Udacity
## Languages
Portuguese: Native
English — Fluent
## Skills
Backend: Node.js, PostgreSQL`);
  assert.equal(report.status, "ready");
  assert.deepEqual(resume.education[0], { institution: "Example University", studyType: "Master of Science", area: "Computer Science", startDate: "2020", endDate: "2022" });
  assert.deepEqual(resume.certificates, [{ name: "React Nanodegree", issuer: "Udacity" }]);
  assert.deepEqual(resume.languages, [{ language: "Portuguese", fluency: "Native" }, { language: "English", fluency: "Fluent" }]);
  assert.deepEqual(resume.skills, [{ name: "Backend", keywords: ["Node.js", "PostgreSQL"] }]);
});

test("reads Markdown locally and rejects scanned PDF text", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-"));
  const input = path.join(directory, "resume.md");
  await fs.writeFile(input, resumeText);
  assert.equal((await readResumeSource(input)).format, "md");
  await assert.rejects(
    readResumeSource("scanned.pdf", { extractPdf: async () => "" }),
    /no extractable text/u
  );
});

test("reconstructs a two-column PDF source and retains coordinate provenance", async () => {
  const pdf = `<doc><page width="612" height="792">
  <word xMin="50" yMin="50" xMax="80" yMax="60">Jane</word><word xMin="84" yMin="50" xMax="110" yMax="60">Doe</word>
  <word xMin="50" yMin="100" xMax="120" yMax="110">Experience</word>
  <word xMin="50" yMin="120" xMax="110" yMax="130">Example</word><word xMin="114" yMin="120" xMax="145" yMax="130">Corp</word><word xMin="150" yMin="120" xMax="151" yMax="130">|</word><word xMin="155" yMin="120" xMax="210" yMax="130">Engineer</word><word xMin="215" yMin="120" xMax="216" yMax="130">|</word><word xMin="220" yMin="120" xMax="250" yMax="130">2021</word>
  <word xMin="350" yMin="100" xMax="390" yMax="110">Skills</word>
  <word xMin="350" yMin="120" xMax="410" yMax="130">Backend:</word><word xMin="415" yMin="120" xMax="460" yMax="130">Node.js</word>
  </page></doc>`;
  const source = await readResumeSource("resume.pdf", { extractPdf: async () => pdf });
  assert.deepEqual(source.lines.map((line) => line.text), ["Jane Doe", "Experience", "Example Corp | Engineer | 2021", "Skills", "Backend: Node.js"]);
  const result = parseResumeDocument(source);
  assert.equal(result.resume.work[0].name, "Example Corp");
  assert.equal(result.report.provenance.find((entry) => entry.path === "/work/0/name").source.page, 1);
  assert.equal(result.report.provenance.find((entry) => entry.path === "/work/0/name").source.items[0].xMin, 50);
});

test("writes a reviewable candidate without replacing base.json", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-"));
  const input = path.join(directory, "resume.txt");
  const output = path.join(directory, "candidate.json");
  await fs.writeFile(input, resumeText);
  const result = await runResumeParser({ input, output });
  assert.equal(result.report.status, "ready");
  assert.equal(JSON.parse(await fs.readFile(output, "utf8")).basics.name, "Jane Doe");
  assert.equal(JSON.parse(await fs.readFile(`${output}.report.json`, "utf8")).status, "ready");
});

test("refuses to overwrite the master resume and standardizes review issues", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-"));
  const input = path.join(directory, "resume.txt");
  await fs.writeFile(input, resumeText);
  await assert.rejects(runResumeParser({ input, output: path.resolve("data/resumes/base.json") }), /Refusing to overwrite/u);
  const { report } = parseResumeText("Jane Doe\n## Experience\nUnclear role");
  assert.equal(report.status, "review_required");
  assert.equal(report.issues[0].severity, "warning");
});

test("reports conflicting work dates without leaking parser metadata into the resume", () => {
  const { resume, report } = parseResumeText(`Jane Doe
## Experience
Example Corp | Engineer | 2020 - 2021
Example Corp | Engineer | 2021 - 2022`);
  assert.equal(report.status, "review_required");
  assert.equal(report.issues.some((issue) => issue.code === "conflicting_work_dates"), true);
  assert.equal(JSON.stringify(resume).includes("provenance"), false);
  assert.equal(JSON.stringify(resume).includes("requiresHumanReview"), false);
});

test("keeps a repeated skill attached to its later source line", () => {
  const result = parseResumeDocument({
    format: "txt", pages: 1, text: "Jane Doe\n## Skills\nBackend: Node.js\nFrontend: Node.js",
    lines: [
      { text: "Jane Doe", source: { page: 1, lineStart: 1 } }, { text: "## Skills", source: { page: 1, lineStart: 2 } },
      { text: "Backend: Node.js", source: { page: 1, lineStart: 3 } }, { text: "Frontend: Node.js", source: { page: 1, lineStart: 4 } },
    ],
  });
  const nodeSources = result.report.provenance.filter((entry) => entry.path.endsWith("/keywords/0"));
  assert.equal(nodeSources.at(-1).source.lineStart, 4);
});

test("keeps extracted values and parser provenance separate", () => {
  const source = { page: 1, lineStart: 4, text: "Example Corp" };
  const entry = extractedEntry({ name: "Example Corp" }, { name: source });
  assert.deepEqual(entry.value, { name: "Example Corp" });
  assert.deepEqual(provenanceForEntry("/work/0", entry.sources), [{ path: "/work/0/name", source }]);
});

test("education extraction returns field-level sourced entries", () => {
  const source = (lineStart, text) => ({ page: 1, lineStart, lineEnd: lineStart, text });
  const entries = extractEducationEntries([
    { text: "Example University | Master of Science | 2020 - 2022", source: source(8, "Example University | Master of Science | 2020 - 2022") },
  ]);
  assert.deepEqual(entries[0].value, { institution: "Example University", studyType: "Master of Science", startDate: "2020", endDate: "2022" });
  assert.equal(entries[0].sources.institution.lineStart, 8);
  assert.equal(entries[0].sources.endDate.lineStart, 8);
});

test("certificate extraction returns sourced entries without changing the resume shape", async () => {
  const { extractCertificateEntries } = await import("../lib/resume-parser/sections.mjs");
  const source = { page: 1, lineStart: 5, text: "React Nanodegree — Udacity" };
  const [entry] = extractCertificateEntries([{ text: source.text, source }]);
  assert.deepEqual(entry.value, { name: "React Nanodegree", issuer: "Udacity" });
  assert.equal(entry.sources.name, source);
  assert.equal(entry.sources.issuer, source);
});

test("language extraction preserves language and fluency sources", async () => {
  const { extractLanguageEntries } = await import("../lib/resume-parser/sections.mjs");
  const source = { page: 1, lineStart: 6, text: "English — Fluent" };
  const [entry] = extractLanguageEntries([{ text: source.text, source }]);
  assert.deepEqual(entry.value, { language: "English", fluency: "Fluent" });
  assert.equal(entry.sources.language, source);
  assert.equal(entry.sources.fluency, source);
});

test("skill extraction preserves category and keyword sources", async () => {
  const { extractSkillEntries } = await import("../lib/resume-parser/sections.mjs");
  const source = { page: 1, lineStart: 7, text: "Backend: Node.js, PostgreSQL" };
  const [entry] = extractSkillEntries([{ text: source.text, source }]);
  assert.deepEqual(entry.value, { name: "Backend", keywords: ["Node.js", "PostgreSQL"] });
  assert.equal(entry.sources.name, source);
  assert.deepEqual(entry.sources.keywords, [source, source]);
});

test("requires explicit parser input and output options", () => {
  assert.throws(() => parseArguments(["--input", "resume.txt"]));
  assert.deepEqual(parseArguments(["--input", "resume.txt", "--output", "candidate.json"]), {
    input: "resume.txt", output: "candidate.json", report: "candidate.json.report.json",
  });
});

test("preserves structured source lines while detecting sections", () => {
  const document = { lines: [{ text: "Jane Doe", source: { lineStart: 1 } }, { text: "## Education", source: { lineStart: 2 } }, { text: "University", source: { lineStart: 3 } }], text: "Jane Doe\n## Education\nUniversity" };
  assert.deepEqual(sectionLines(document, "education"), [document.lines[2]]);
});

test("extracts basics with field-level sources", () => {
  const source = { page: 1, lineStart: 1, text: "Jane Doe" };
  const entry = extractBasicsEntry([{ text: "Jane Doe", source }, { text: "Engineer", source: { page: 1, lineStart: 2 } }, { text: "jane@example.com", source: { page: 1, lineStart: 3 } }]);
  assert.equal(entry.value.name, "Jane Doe");
  assert.equal(entry.sources.name, source);
  assert.equal(entry.sources.email.lineStart, 3);
});

test("extracts an explicit location and summary without treating them as name or label", () => {
  const values = [
    "Jane Doe",
    "Senior Software Engineer",
    "Manaus, AM, Brazil",
    "jane@example.com | +55 92 99999-0000 | https://linkedin.com/in/jane",
    "Professional Summary",
    "Builds reliable distributed systems.",
    "Preserves factual wording and measurable outcomes.",
  ];
  const lines = values.map((text, index) => ({
    text,
    source: { page: 1, lineStart: index + 1, lineEnd: index + 1, text, format: "txt" },
  }));
  const { resume, report } = parseResumeDocument({ format: "txt", pages: 1, text: values.join("\n"), lines });
  const sources = Object.fromEntries(report.provenance.map(({ path, source }) => [path, source]));

  assert.equal(report.status, "ready");
  assert.equal(resume.basics.name, "Jane Doe");
  assert.equal(resume.basics.label, "Senior Software Engineer");
  assert.deepEqual(resume.basics.location, { address: "Manaus, AM, Brazil" });
  assert.equal(resume.basics.summary, "Builds reliable distributed systems. Preserves factual wording and measurable outcomes.");
  assert.equal(sources["/basics/location"].lineStart, 3);
  assert.equal(sources["/basics/summary"].lineStart, 6);
  assert.equal(sources["/basics/summary"].lineEnd, 7);
});

test("only extracts location from an explicit location-shaped line", () => {
  const entry = extractBasicsEntry(["Jane Doe", "Senior Software Engineer", "Available for remote work"]);
  assert.deepEqual(entry.value, { name: "Jane Doe", label: "Senior Software Engineer" });
});

test("reports structured conflict candidates with their sources", () => {
  const sourceA = { page: 1, lineStart: 4 };
  const sourceB = { page: 2, lineStart: 6 };
  const entries = [
    { value: { name: "Example Corp", position: "Engineer", startDate: "2020", endDate: "2021" }, sources: { startDate: sourceA } },
    { value: { name: "Example Corp", position: "Engineer", startDate: "2021", endDate: "2022" }, sources: { startDate: sourceB } },
  ];
  const [issue] = findEntryConflicts(entries, "work");
  assert.equal(issue.code, "conflicting_work_dates");
  assert.equal(issue.candidates[0].source.startDate, sourceA);
  assert.equal(issue.candidates[1].source.startDate, sourceB);
});

test("reports complete section counts while keeping internal metadata out of the resume", () => {
  const { resume, report } = parseResumeText(resumeText);
  assert.deepEqual(report.summary, { workEntries: 2, educationEntries: 1, skills: 1, certificateEntries: 1, languageEntries: 1, issues: 0 });
  assert.equal(JSON.stringify(resume).includes("sources"), false);
  assert.equal(JSON.stringify(resume).includes("requiresHumanReview"), false);
});

test("retains the originating line for each field in multi-line entries", () => {
  const values = [
    "Jane Doe", "jane@example.com", "Experience", "Senior Software Engineer",
    "Example Corp", "2021 - 2023", "Education", "Master of Science",
    "Example University", "2018 - 2020",
  ];
  const lines = values.map((text, index) => ({
    text,
    source: { page: 1, lineStart: index + 1, lineEnd: index + 1, text, format: "txt" },
  }));
  const result = parseResumeDocument({ format: "txt", pages: 1, text: values.join("\n"), lines });
  const sources = Object.fromEntries(result.report.provenance.map(({ path, source }) => [path, source]));

  assert.equal(sources["/basics/email"].lineStart, 2);
  assert.equal(sources["/work/0/position"].lineStart, 4);
  assert.equal(sources["/work/0/name"].lineStart, 5);
  assert.equal(sources["/work/0/startDate"].lineStart, 6);
  assert.equal(sources["/education/0/studyType"].lineStart, 8);
  assert.equal(sources["/education/0/institution"].lineStart, 9);
  assert.equal(sources["/education/0/startDate"].lineStart, 10);
});

test("reports each work conflict only once", () => {
  const { report } = parseResumeText(`Jane Doe
Experience
Example Corp | Engineer | 2020 - 2021
Example Corp | Engineer | 2021 - 2022`);
  assert.equal(report.issues.filter(({ code }) => code === "conflicting_work_dates").length, 1);
});

test("normalizes supported date precision and rejects invalid calendar dates", () => {
  assert.deepEqual(parseDateRange("Mar 1999 - Apr 2000"), { startDate: "1999-03", endDate: "2000-04" });
  assert.deepEqual(parseDateRange("2020-02-29 - 2021-03-01"), { startDate: "2020-02-29", endDate: "2021-03-01" });
  assert.deepEqual(parseDateRange("03/2021 - Present"), { startDate: "2021-03" });
  assert.deepEqual(parseDateRange("2021-12 - 2021"), { startDate: "2021-12", endDate: "2021" });
  assert.equal(inspectDateRange("2021-02-29").error, "invalid_start_date");
  assert.equal(inspectDateRange("2023 - 2021").error, "inverted_date_range");
});

test("reports malformed work and education dates for human review", () => {
  const { resume, report } = parseResumeText(`Jane Doe
Experience
Example Corp | Engineer | 2023 - 2021
Education
Example University | Master of Science | 2021-02-29`);
  assert.equal(resume.work, undefined);
  assert.equal(resume.education, undefined);
  assert.equal(report.status, "review_required");
  assert.deepEqual(report.issues.map(({ code }) => code), ["invalid_work_date", "invalid_education_date"]);
});

test("uses structured error codes for source extraction failures", async () => {
  await assert.rejects(readResumeSource("resume.docx"), (error) => error.code === "RESUME_FORMAT_UNSUPPORTED");
  await assert.rejects(
    readResumeSource("resume.pdf", { extractPdf: async () => { throw new Error("poppler unavailable"); } }),
    (error) => error.code === "RESUME_TEXT_EXTRACTION_FAILED" && !error.message.includes("poppler unavailable")
  );
  assert.throws(() => parseArguments(["--input", "resume.txt"]), (error) => error.code === "RESUME_ARGUMENT_ERROR");
});

test("writes a failed validation report without writing a candidate", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-"));
  const output = path.join(directory, "candidate.json");
  const reportPath = path.join(directory, "review.json");
  const failedReport = { status: "failed", issues: [{ code: "schema_validation", message: "invalid" }] };

  await assert.rejects(
    runResumeParser(
      { input: "resume.txt", output, report: reportPath },
      { readSource: async () => ({ text: "Jane", lines: [] }), parseDocument: () => ({ resume: {}, report: failedReport }) }
    ),
    (error) => error.code === "RESUME_VALIDATION_FAILED" && error.details.reportPath === reportPath
  );
  assert.deepEqual(JSON.parse(await fs.readFile(reportPath, "utf8")), failedReport);
  await assert.rejects(fs.access(output));
});

test("extracts explicit work locations and recognizes Portuguese role titles", () => {
  const { resume, report } = parseResumeText(`Jane Doe
Experiência
Engenheira de Software
Example Corp
Manaus, AM
2021 - Atual
Construiu APIs sem alterar métricas.
Other Corp | Analista de Dados | Remoto | 2019 - 2020`);

  assert.equal(report.status, "ready");
  assert.deepEqual(resume.work.map(({ name, position, location }) => ({ name, position, location })), [
    { name: "Example Corp", position: "Engenheira de Software", location: "Manaus, AM" },
    { name: "Other Corp", position: "Analista de Dados", location: "Remoto" },
  ]);
});

test("extracts explicit education area from delimited and multi-line entries", () => {
  const { resume, report } = parseResumeText(`Jane Doe
Education
Example University | Bachelor of Science | Computer Science | 2015 - 2019
Especialização
Other University
Área: Sistemas Distribuídos
2020 - 2021`);

  assert.equal(report.status, "ready");
  assert.deepEqual(resume.education, [
    { institution: "Example University", studyType: "Bachelor of Science", area: "Computer Science", startDate: "2015", endDate: "2019" },
    { institution: "Other University", studyType: "Especialização", area: "Sistemas Distribuídos", startDate: "2020", endDate: "2021" },
  ]);
});

test("extracts certificate date and URL while reporting malformed dates", () => {
  const { resume, report } = parseResumeText(`Jane Doe
Certificates
Cloud Certification | Example Institute | 2022-05 | https://example.com/certificate
Invalid Certificate | Example Institute | 2022-02-30`);

  assert.deepEqual(resume.certificates, [
    { name: "Cloud Certification", issuer: "Example Institute", date: "2022-05", url: "https://example.com/certificate" },
    { name: "Invalid Certificate", issuer: "Example Institute" },
  ]);
  assert.equal(report.issues.some(({ code }) => code === "invalid_certificate_date"), true);
});

test("preserves only explicitly stated skill levels", () => {
  const { resume } = parseResumeText(`Jane Doe
Skills
Backend (Advanced): Node.js, PostgreSQL
Cloud | Intermediate | AWS, GCP
Runtime (Node.js): APIs
Observability: Grafana`);

  assert.deepEqual(resume.skills, [
    { name: "Backend", level: "Advanced", keywords: ["Node.js", "PostgreSQL"] },
    { name: "Cloud", level: "Intermediate", keywords: ["AWS", "GCP"] },
    { name: "Runtime (Node.js)", keywords: ["APIs"] },
    { name: "Observability", keywords: ["Grafana"] },
  ]);
});

test("retains provenance for newly supported explicit fields", () => {
  const values = [
    "Jane Doe",
    "Experience",
    "Example Corp | Engenheira de Software | Manaus, AM | 2021 - 2023",
    "Education",
    "Example University | Bachelor of Science | Computer Science | 2015 - 2019",
    "Certificates",
    "Cloud Certification | Example Institute | 2022 | https://example.com/certificate",
    "Skills",
    "Backend (Avançado): Node.js",
  ];
  const lines = values.map((text, index) => ({ text, source: { page: 1, lineStart: index + 1, text, format: "txt" } }));
  const { report } = parseResumeDocument({ format: "txt", pages: 1, text: values.join("\n"), lines });
  const paths = new Set(report.provenance.map(({ path }) => path));

  for (const path of ["/work/0/location", "/education/0/area", "/certificates/0/date", "/certificates/0/url", "/skills/0/level"]) {
    assert.equal(paths.has(path), true, `missing provenance for ${path}`);
  }
});
