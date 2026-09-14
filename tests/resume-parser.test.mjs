import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseResumeText } from "../lib/resume-parser/parse.mjs";
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
