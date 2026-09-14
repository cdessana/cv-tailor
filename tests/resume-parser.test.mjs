import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parseResumeDocument, parseResumeText } from "../lib/resume-parser/parse.mjs";
import { readResumeSource } from "../lib/resume-parser/read-source.mjs";
import { parseArguments, runResumeParser, writeJsonPairTransactional } from "../scripts/resume-parser.mjs";
import { extractedEntry, provenanceForEntry } from "../lib/resume-parser/extracted-entry.mjs";
import { extractEducationEntries } from "../lib/resume-parser/education.mjs";
import { extractBasicsEntry } from "../lib/resume-parser/basics.mjs";
import { findEntryConflicts } from "../lib/resume-parser/conflicts.mjs";
import { inspectDateRange, parseDateRange } from "../lib/resume-parser/dates.mjs";
import { validateResume } from "../lib/resume-parser/validate.mjs";

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

function minimalTextPdf(lines) {
  const escaped = lines.map((line) => line.replace(/([\\()])/gu, "\\$1"));
  const commands = escaped.map((line, index) => `${index ? "0 -18 Td " : ""}(${line}) Tj`).join("\n");
  const stream = `BT\n/F1 11 Tf\n50 750 Td\n${commands}\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

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

test("protects the base resume path supplied by configuration", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-"));
  const configuredBase = path.join(directory, "master.json");
  let sourceRead = false;

  await assert.rejects(
    runResumeParser(
      { input: "resume.txt", output: configuredBase },
      {
        loadConfiguration: () => ({ paths: { baseResume: configuredBase } }),
        readSource: async () => { sourceRead = true; },
      }
    ),
    (error) => error.code === "RESUME_OUTPUT_PROTECTED" && error.details.baseResumePath === configuredBase
  );
  assert.equal(sourceRead, false);
});

test("rolls back both artifacts when publishing the report fails", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-"));
  const candidatePath = path.join(directory, "candidate.json");
  const reportPath = path.join(directory, "report.json");
  await fs.writeFile(candidatePath, "old candidate\n");
  await fs.writeFile(reportPath, "old report\n");
  let rejectedReportPublish = false;
  const fileSystem = {
    ...fs,
    async rename(source, target) {
      if (!rejectedReportPublish && source.endsWith(".tmp") && target === reportPath) {
        rejectedReportPublish = true;
        const error = new Error("simulated report publish failure");
        error.code = "EIO";
        throw error;
      }
      return fs.rename(source, target);
    },
  };

  await assert.rejects(
    writeJsonPairTransactional(candidatePath, { name: "new" }, reportPath, { status: "ready" }, { fileSystem }),
    /simulated report publish failure/u
  );
  assert.equal(await fs.readFile(candidatePath, "utf8"), "old candidate\n");
  assert.equal(await fs.readFile(reportPath, "utf8"), "old report\n");
  assert.deepEqual((await fs.readdir(directory)).sort(), ["candidate.json", "report.json"]);
});

test("rejects a shared candidate and report output path", async () => {
  const target = path.join(os.tmpdir(), "same-resume-output.json");
  await assert.rejects(
    writeJsonPairTransactional(target, {}, target, {}),
    (error) => error.code === "RESUME_OUTPUT_PATH_CONFLICT"
  );
});

test("preserves metrics and cautious wording without inventing technologies", async () => {
  const fixturePath = new URL("./fixtures/resume-parser/factual-resume.txt", import.meta.url);
  const sourceText = await fs.readFile(fixturePath, "utf8");
  const { resume, report } = parseResumeText(sourceText);
  const serialized = JSON.stringify(resume);

  assert.equal(report.status, "ready");
  assert.equal(resume.basics.summary, "Contributed to reliable backend systems and measurable delivery improvements.");
  assert.deepEqual(resume.work[0].highlights, ["Reduced API latency by 37% using Node.js and MongoDB."]);
  assert.deepEqual(resume.work[1].highlights, ["Contributed to C# and gRPC services."]);
  assert.equal(serialized.includes("37%"), true);
  assert.equal(serialized.includes("Led"), false);
  assert.equal(serialized.includes("Spring"), false);
  assert.equal(serialized.includes("Kafka"), false);
  assert.equal(serialized.includes("Kubernetes"), false);
});

test("keeps technologies and metrics attached to their source roles", async () => {
  const fixturePath = new URL("./fixtures/resume-parser/factual-resume.txt", import.meta.url);
  const { resume } = parseResumeText(await fs.readFile(fixturePath, "utf8"));
  const firstRole = JSON.stringify(resume.work[0]);
  const secondRole = JSON.stringify(resume.work[1]);

  assert.equal(firstRole.includes("Node.js"), true);
  assert.equal(firstRole.includes("MongoDB"), true);
  assert.equal(firstRole.includes("C#"), false);
  assert.equal(firstRole.includes("gRPC"), false);
  assert.equal(secondRole.includes("C#"), true);
  assert.equal(secondRole.includes("gRPC"), true);
  assert.equal(secondRole.includes("Node.js"), false);
  assert.equal(secondRole.includes("37%"), false);
});

test("does not infer a skills section from the candidate title or work entries", () => {
  const { resume } = parseResumeText(`Jane Doe
Java Developer
Experience
Example Corp | Java Developer | 2020 - 2022
Maintained internal services.`);

  assert.equal(resume.basics.label, "Java Developer");
  assert.equal(resume.skills, undefined);
  assert.equal(JSON.stringify(resume).includes("Spring"), false);
});

test("does not access a semantic provider or network during deterministic parsing", () => {
  const originalFetch = globalThis.fetch;
  let requested = false;
  globalThis.fetch = () => {
    requested = true;
    throw new Error("network access is forbidden in resume parser tests");
  };
  try {
    const { resume } = parseResumeText("Jane Doe\nSkills\nBackend: Node.js");
    assert.deepEqual(resume.skills, [{ name: "Backend", keywords: ["Node.js"] }]);
    assert.equal(requested, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not leave artifacts when the source format is unsupported", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-"));
  const input = path.join(directory, "resume.docx");
  const output = path.join(directory, "candidate.json");
  const report = `${output}.report.json`;
  await fs.writeFile(input, "not a supported resume");

  await assert.rejects(
    runResumeParser(
      { input, output },
      { loadConfiguration: () => ({ paths: { baseResume: path.join(directory, "base.json") } }) }
    ),
    (error) => error.code === "RESUME_FORMAT_UNSUPPORTED"
  );
  await assert.rejects(fs.access(output));
  await assert.rejects(fs.access(report));
});

test("does not leave artifacts when PDF text extraction fails", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-"));
  const output = path.join(directory, "candidate.json");
  const report = `${output}.report.json`;

  await assert.rejects(
    runResumeParser(
      { input: "broken.pdf", output },
      {
        loadConfiguration: () => ({ paths: { baseResume: path.join(directory, "base.json") } }),
        readSource: () => readResumeSource("broken.pdf", { extractPdf: async () => { throw new Error("pdftotext failed"); } }),
      }
    ),
    (error) => error.code === "RESUME_TEXT_EXTRACTION_FAILED"
  );
  await assert.rejects(fs.access(output));
  await assert.rejects(fs.access(report));
});

test("parses the minimum plain-text role format with an em dash", () => {
  const { resume, report } = parseResumeText(`Jane Doe
Experience
Software Engineer — Example Corp
2021 - 2024
Developed services using Java.`);

  assert.equal(report.status, "ready");
  assert.deepEqual(resume.work, [{
    name: "Example Corp",
    position: "Software Engineer",
    startDate: "2021",
    endDate: "2024",
    highlights: ["Developed services using Java."],
  }]);
  assert.equal(JSON.stringify(resume).includes("Spring"), false);
});

test("keeps an explicit undated work entry without inventing dates", () => {
  const { resume, report } = parseResumeText(`Jane Doe
Experience
Software Engineer
Example Corp
Maintained internal services.`);

  assert.deepEqual(resume.work, [{
    name: "Example Corp",
    position: "Software Engineer",
    highlights: ["Maintained internal services."],
  }]);
  assert.equal(Object.hasOwn(resume.work[0], "startDate"), false);
  assert.equal(Object.hasOwn(resume.work[0], "endDate"), false);
  assert.equal(report.issues.some(({ code }) => code === "missing_work_dates"), true);
});

test("does not convert certificate evidence into work experience or skills", () => {
  const { resume } = parseResumeText(`Jane Doe
Certificates
React Nanodegree — Udacity`);

  assert.deepEqual(resume.certificates, [{ name: "React Nanodegree", issuer: "Udacity" }]);
  assert.equal(resume.work, undefined);
  assert.equal(resume.skills, undefined);
});

test("parses a real text PDF through the installed pdftotext command", async (t) => {
  const availability = spawnSync("pdftotext", ["-v"], { stdio: "ignore" });
  if (availability.error?.code === "ENOENT") {
    t.skip("Poppler pdftotext is not installed");
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-pdf-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, "resume.pdf");
  await fs.writeFile(input, minimalTextPdf([
    "Jane Doe",
    "Experience",
    "Example Corp | Software Engineer | 2021 - 2024",
    "Developed services using Java.",
  ]));

  const document = await readResumeSource(input);
  const { resume, report } = parseResumeDocument(document);
  assert.equal(report.status, "ready");
  assert.equal(resume.basics.name, "Jane Doe");
  assert.deepEqual(resume.work[0], {
    name: "Example Corp",
    position: "Software Engineer",
    startDate: "2021",
    endDate: "2024",
    highlights: ["Developed services using Java."],
  });
  assert.equal(report.provenance.some(({ source }) => source.format === "pdf" && source.page === 1), true);
});

test("keeps the existing base resume valid without migration", async () => {
  const basePath = path.join(path.resolve("."), "data/resumes/base.json");
  const before = await fs.readFile(basePath, "utf8");
  const resume = JSON.parse(before);
  assert.deepEqual(validateResume(resume), { valid: true, errors: [] });
  assert.equal(await fs.readFile(basePath, "utf8"), before);
});

test("preserves bullets containing role words and still detects the next work entry", () => {
  const { resume, report } = parseResumeText(`Jane Doe
Experience
Example Corp | Software Engineer | 2021 - 2024
- Collaborated with the lead engineer on APIs.
* Supported the software architect during migration.
• Mentored a developer through onboarding.
1. Partnered with the engineering manager.
Other Corp | Backend Engineer | 2024 - Present
- Built reliable services.`);

  assert.equal(report.status, "ready");
  assert.deepEqual(resume.work[0].highlights, [
    "Collaborated with the lead engineer on APIs.",
    "Supported the software architect during migration.",
    "Mentored a developer through onboarding.",
    "Partnered with the engineering manager.",
  ]);
  assert.deepEqual(resume.work[1].highlights, ["Built reliable services."]);
});

test("associates a standalone PDF bullet marker with the following line", () => {
  const values = [
    "Jane Doe",
    "Experience",
    "Example Corp | Software Engineer | 2021 - 2024",
    "•",
    "Collaborated with the lead engineer on APIs.",
  ];
  const lines = values.map((text, index) => ({
    text,
    source: { page: 1, lineStart: index + 1, lineEnd: index + 1, text, format: "pdf" },
  }));
  const { resume, report } = parseResumeDocument({ format: "pdf", pages: 1, text: values.join("\n"), lines });

  assert.equal(report.status, "ready");
  assert.deepEqual(resume.work[0].highlights, ["Collaborated with the lead engineer on APIs."]);
  const evidence = report.provenance.find(({ path }) => path === "/work/0/highlights/0");
  assert.equal(evidence.source.lineStart, 5);
  assert.equal(evidence.source.text, "Collaborated with the lead engineer on APIs.");
});

test("retains original bullet source text in provenance", () => {
  const values = [
    "Jane Doe",
    "Experience",
    "Example Corp | Software Engineer | 2021 - 2024",
    "- Collaborated with the lead engineer on APIs.",
  ];
  const lines = values.map((text, index) => ({
    text,
    source: { page: 1, lineStart: index + 1, lineEnd: index + 1, text, format: "md" },
  }));
  const { report } = parseResumeDocument({ format: "md", pages: 1, text: values.join("\n"), lines });
  const evidence = report.provenance.find(({ path }) => path === "/work/0/highlights/0");

  assert.equal(evidence.source.text, "- Collaborated with the lead engineer on APIs.");
});

test("rejects readable text without minimum resume structure", () => {
  for (const text of [
    "This is not a resume",
    "Markets closed higher today after a broad rally across technology companies.",
    "Jane Doe",
  ]) {
    const { report } = parseResumeText(text);
    assert.equal(report.status, "failed", text);
    const issue = report.issues.find(({ code }) => code === "malformed_resume_content");
    assert.equal(issue.severity, "error");
    assert.equal(issue.requiresHumanReview, false);
  }
});

test("accepts minimal resumes with an independent contact, title, or section signal", () => {
  const contact = parseResumeText("Jane Doe\njane@example.com");
  assert.equal(contact.report.status, "ready");
  assert.equal(contact.resume.basics.email, "jane@example.com");

  const title = parseResumeText("Jane Doe\nSoftware Engineer");
  assert.equal(title.report.status, "ready");
  assert.equal(title.resume.basics.label, "Software Engineer");

  const ambiguousWork = parseResumeText("Jane Doe\nExperience\nWorked with messaging systems.");
  assert.equal(ambiguousWork.report.status, "review_required");
  assert.equal(ambiguousWork.report.issues.some(({ code }) => code === "malformed_resume_content"), false);
});

test("writes a malformed-input report without publishing a candidate", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-malformed-"));
  const input = path.join(directory, "input.txt");
  const output = path.join(directory, "candidate.json");
  const reportPath = `${output}.report.json`;
  await fs.writeFile(input, "This is not a resume");

  await assert.rejects(
    runResumeParser(
      { input, output },
      { loadConfiguration: () => ({ paths: { baseResume: path.join(directory, "base.json") } }) }
    ),
    (error) => error.code === "RESUME_MALFORMED_INPUT" && error.details.reportPath === reportPath
  );
  await assert.rejects(fs.access(output));
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.status, "failed");
  assert.equal(report.issues.some(({ code }) => code === "malformed_resume_content"), true);
});
