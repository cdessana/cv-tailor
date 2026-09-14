import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseResumeDocument, parseResumeText } from "../lib/resume-parser/parse.mjs";
import { readResumeSource } from "../lib/resume-parser/read-source.mjs";
import { parseArguments, runResumeParser } from "../scripts/resume-parser.mjs";

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
  assert.deepEqual(resume.education[0], { institution: "Example University", studyType: "Master of Science in Computer Science", startDate: "2020", endDate: "2022" });
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

test("requires explicit parser input and output options", () => {
  assert.throws(() => parseArguments(["--input", "resume.txt"]));
  assert.deepEqual(parseArguments(["--input", "resume.txt", "--output", "candidate.json"]), {
    input: "resume.txt", output: "candidate.json", report: "candidate.json.report.json",
  });
});
