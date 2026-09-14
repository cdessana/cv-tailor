import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseArguments,
  reportWarnings,
  runJobParser,
} from "../scripts/job-parser.mjs";

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "job-parser-"));
}

test("parses positional and flag arguments", () => {
  assert.deepEqual(parseArguments(["description.txt"]), {
    input: "description.txt",
    output: "data/jobs/description.json",
  });
  assert.deepEqual(
    parseArguments(["--input", "description.txt", "--output", "out.json"]),
    { input: "description.txt", output: "out.json" }
  );
  assert.deepEqual(
    parseArguments(["description.txt", "--semantic-provider", "ollama"]),
    {
      input: "description.txt",
      output: "data/jobs/description.json",
      semanticProviderName: "ollama",
    }
  );
  assert.equal(parseArguments(["description.txt", "--checkpoint", "run.json"]).checkpoint, "run.json");
  for (const args of [
    ["--input"],
    ["--unknown"],
    ["a", "b"],
    ["--input", "a", "b"],
  ])
    assert.throws(() => parseArguments(args));
});

test("reports conflicting metadata candidates in a human-readable CLI warning", () => {
  const messages = [];
  reportWarnings(
    [
      {
        code: "ambiguous_metadata",
        path: "/metadata/location",
        requiresHumanValidation: true,
        selected: { value: "São Paulo" },
        candidates: [{ value: "São Paulo" }, { value: "Brasil" }],
      },
    ],
    { warn: (message) => messages.push(message) }
  );
  assert.deepEqual(messages, [
    '[job-parser] HUMAN_VALIDATION_REQUIRED: location selected "São Paulo"; other source-backed candidate(s): "Brasil".',
  ]);
});

test("programmatic parser calls default the output path", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "job.txt");
  await fs.writeFile(
    input,
    "Example is hiring a Senior Engineer\nRequirements\n- Node.js is required",
    "utf8"
  );
  const previous = process.cwd();
  process.chdir(directory);
  try {
    const result = await runJobParser({ input });
    assert.equal(result.output, path.join("data", "jobs", "job.json"));
    await fs.access(result.output);
    await fs.access(`${result.output}.report.json`);
  } finally {
    process.chdir(previous);
  }
});

test("runs the full flow with an injected semantic provider and writes valid output", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "job.txt");
  const output = path.join(directory, "out", "job.json");
  await fs.writeFile(
    input,
    "Example role\nRequirements\n- Experience with Node.js is required\nResponsibilities\n- You will mentor engineers",
    "utf8"
  );
  const result = await runJobParser({
    input,
    output,
    semanticProvider: ({ unresolved }) => {
      const extraction = {
      metadata: {
        company: { value: "Example", evidence: { quote: "Example" } },
        title: { value: "Example role", evidence: { quote: "Example role" } },
      },
      items: [
        {
          type: "item",
          value: "You will mentor engineers",
          kind: "responsibility",
          classification: "not-applicable",
          evidence: { quote: "You will mentor engineers" },
          sourceSection: "Responsibilities",
        },
      ],
        ...(unresolved.length ? {} : {}),
      };
      Object.defineProperty(extraction, "providerReport", {
        value: { completed: 1, corrections: 0 },
        enumerable: false,
      });
      return extraction;
    },
  });
  assert.equal(result.job.company, "Example");
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), result.job);
  assert.deepEqual(
    JSON.parse(await fs.readFile(`${output}.report.json`, "utf8")).batches,
    { completed: 1, corrections: 0 }
  );
});

test("runs a fully deterministic raw JD without a semantic provider", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "job.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(
    input,
    "Example is hiring a Senior Engineer\nRequirements\n- Node.js is required",
    "utf8"
  );
  const result = await runJobParser({ input, output });
  assert.equal(result.job.company, "Example");
  assert.deepEqual(result.job.requirements.required, ["Node.js"]);
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), result.job);
});

test("fails without a semantic provider and does not create output", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "job.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\nCandidate profile\n- Modern cloud experience", "utf8");
  await assert.rejects(() => runJobParser({ input, output }), /SEMANTIC_ERROR/);
  await assert.rejects(() => fs.access(output));
});

test("provider, evidence, mapping, and output failures do not write partial output", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "job.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(
    input,
    "Example\nRequirements\n- Experience with Node.js is required",
    "utf8"
  );
  await assert.rejects(
    () =>
      runJobParser({
        input,
        output,
        semanticProvider: () => ({
          items: [
            {
              type: "item",
              value: "AWS",
              kind: "skill",
              classification: "required",
              evidence: { quote: "not source" },
            },
          ],
        }),
      }),
    /SEMANTIC_ERROR/
  );
  await assert.rejects(() => fs.access(output));
  await assert.rejects(
    () => runJobParser({ input: path.join(directory, "missing.txt"), output }),
    /INPUT_ERROR/
  );
});

test("failed replacement preserves an existing output", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "job.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\nCandidate profile\n- Modern cloud experience", "utf8");
  await fs.writeFile(output, '{"company":"Previous","title":"Job"}\n', "utf8");
  await assert.rejects(() => runJobParser({ input, output }), /SEMANTIC_ERROR/);
  assert.equal(
    await fs.readFile(output, "utf8"),
    '{"company":"Previous","title":"Job"}\n'
  );
});
