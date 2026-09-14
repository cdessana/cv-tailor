import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  diagnoseEnvironment,
  diagnosticExitCode,
} from "../lib/doctor/diagnostics.mjs";
import {
  inspectConfiguredPaths,
  resolveBrowser,
  commandRunner,
  runDoctorCli,
} from "../scripts/doctor.mjs";

function dependencies(overrides = {}) {
  return {
    nodeVersion: "22.12.0",
    env: {},
    loadConfig: () => ({
      jobParser: {
        semanticProvider: "none",
        providers: {
          ollama: { model: "test-model", url: "http://127.0.0.1:11434" },
        },
      },
      render: {},
      paths: {
        baseResume: "/data/base.json",
        evidence: "/data/evidence.json",
        aliases: "/data/aliases.json",
        jobs: "/data/jobs",
        output: "/output",
      },
    }),
    packageManifest: { dependencies: { zod: "1" } },
    resolveDependency: () => true,
    commandRunner: (command) => ({
      ok: command !== "ollama",
      version: `${command} test version`,
    }),
    commandLocator: () => null,
    resolveBrowser: async () => ({ available: true, path: "/browser" }),
    inspectConfiguredPaths: async () => [],
    ...overrides,
  };
}

test("doctor reports ready with optional capabilities missing", async () => {
  const report = await diagnoseEnvironment(dependencies());
  assert.equal(report.status, "ready-with-warnings");
  assert.equal(diagnosticExitCode(report.status), 2);
  assert.equal(
    report.checks.find((check) => check.id === "ollama").category,
    "optional"
  );
  assert.match(
    report.checks.find((check) => check.id === "job-parser-provider").message,
    /no job description is sent/u
  );
});

test("doctor reports ready when every capability is available", async () => {
  const report = await diagnoseEnvironment(
    dependencies({
      env: { GEMINI_API_KEY: "secret" },
      commandLocator: () => "/bin/ollama",
    })
  );
  assert.equal(report.status, "ready");
  assert.equal(diagnosticExitCode(report.status), 0);
});

test("doctor distinguishes missing required dependencies from optional ones", async () => {
  const report = await diagnoseEnvironment(
    dependencies({
      resolveDependency: () => false,
      commandRunner: () => ({ ok: false }),
      commandLocator: () => null,
      resolveBrowser: async () => ({ available: false }),
    })
  );
  assert.equal(report.status, "blocked");
  assert.equal(diagnosticExitCode(report.status), 1);
  assert.ok(
    report.checks.some(
      (check) => check.category === "required" && check.status === "fail"
    )
  );
  assert.ok(
    report.checks.some(
      (check) => check.category === "optional" && check.status === "warn"
    )
  );
});

test("doctor blocks unsupported Node.js versions", async () => {
  const report = await diagnoseEnvironment(
    dependencies({ nodeVersion: "20.19.0" })
  );
  const check = report.checks.find((candidate) => candidate.id === "node");
  assert.equal(report.status, "blocked");
  assert.equal(check.status, "fail");
  assert.match(check.action, /Node\.js 22\+/u);
});

test("doctor identifies an individually missing Poppler command", async () => {
  const report = await diagnoseEnvironment(
    dependencies({
      commandRunner: (command) => ({
        ok: command !== "pdfinfo",
        version: `${command} test version`,
      }),
    })
  );
  assert.equal(
    report.checks.find((candidate) => candidate.id === "pdftotext").status,
    "pass"
  );
  assert.equal(
    report.checks.find((candidate) => candidate.id === "pdfinfo").status,
    "fail"
  );
});

test("doctor supports asynchronous command checks", async () => {
  const report = await diagnoseEnvironment(
    dependencies({
      commandRunner: async (command) => ({
        ok: command !== "pdfinfo",
        version: `${command} test version`,
      }),
    })
  );
  assert.equal(report.checks.find((check) => check.id === "npm").status, "pass");
  assert.equal(report.checks.find((check) => check.id === "pdfinfo").status, "fail");
});

test("doctor command runner times out without blocking", async () => {
  const result = await commandRunner(
    process.execPath,
    ["-e", "setTimeout(() => {}, 1_000)"],
    { timeout: 20 }
  );
  assert.deepEqual(result, { ok: false, timedOut: true });
});

test("doctor never exposes the Gemini credential", async () => {
  const secret = "super-secret-key";
  const report = await diagnoseEnvironment(
    dependencies({ env: { GEMINI_API_KEY: secret } })
  );
  assert.equal(
    report.checks.find((check) => check.id === "gemini").status,
    "pass"
  );
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("doctor recognizes a Gemini key saved in application configuration", async () => {
  const secret = "saved-gemini-key";
  const report = await diagnoseEnvironment(
    dependencies({
      loadConfig: () => ({
        llm: { gemini: { apiKey: secret } },
        jobParser: { semanticProvider: "none", providers: { ollama: { model: "test-model", url: "http://127.0.0.1:11434" } } },
        render: {},
        paths: { baseResume: "/data/base.json", evidence: "/data/evidence.json", aliases: "/data/aliases.json", jobs: "/data/jobs", output: "/output" },
      }),
    })
  );
  const gemini = report.checks.find((check) => check.id === "gemini");
  assert.equal(gemini.status, "pass");
  assert.match(gemini.message, /cv-tailor\.config\.json/u);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("doctor reports configuration errors as blocking and actionable", async () => {
  const report = await diagnoseEnvironment(
    dependencies({
      loadConfig: () => {
        throw new Error("Invalid configuration: render.theme");
      },
    })
  );
  const check = report.checks.find(
    (candidate) => candidate.id === "configuration"
  );
  assert.equal(report.status, "blocked");
  assert.equal(check.status, "fail");
  assert.match(check.action, /Correct the configuration/u);
});

test("doctor reports configured directories that are not ready", async () => {
  const report = await diagnoseEnvironment(
    dependencies({
      inspectConfiguredPaths: async () => [
        { name: "output", message: "output path is not writable." },
      ],
    })
  );
  const check = report.checks.find((candidate) => candidate.id === "paths");
  assert.equal(check.status, "fail");
  assert.match(check.message, /not writable/u);
  assert.match(check.action, /permissions/u);
});

test("path inspection rejects an output path that is an existing file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doctor-paths-"));
  const output = path.join(directory, "output");
  await fs.writeFile(output, "not a directory");
  const issues = await inspectConfiguredPaths({
    baseResume: path.join(directory, "base.json"),
    evidence: path.join(directory, "evidence.json"),
    aliases: path.join(directory, "aliases.json"),
    jobs: path.join(directory, "jobs"),
    output,
  });
  assert.match(
    issues.find((issue) => issue.name === "output").message,
    /not a directory/u
  );
});

test("doctor records explicit cloud-provider selection without credentials", async () => {
  const report = await diagnoseEnvironment(
    dependencies({
      loadConfig: () => ({
        jobParser: { semanticProvider: "gemini" },
        render: {},
        paths: {
          baseResume: "/data/base.json",
          evidence: "/data/evidence.json",
          aliases: "/data/aliases.json",
          jobs: "/data/jobs",
          output: "/output",
        },
      }),
    })
  );
  assert.match(
    report.checks.find((check) => check.id === "job-parser-provider").message,
    /explicitly selected/u
  );
});

test("doctor applies the environment provider override to its privacy report", async () => {
  const report = await diagnoseEnvironment(
    dependencies({ env: { JOB_PARSER_PROVIDER: "ollama" } })
  );
  assert.match(
    report.checks.find((check) => check.id === "job-parser-provider").message,
    /ollama was explicitly selected/u
  );
});

test("doctor reports invalid provider overrides as blocking", async () => {
  const report = await diagnoseEnvironment(
    dependencies({ env: { JOB_PARSER_PROVIDER: "unknown" } })
  );
  const check = report.checks.find(
    (candidate) => candidate.id === "job-parser-provider"
  );
  assert.equal(report.status, "blocked");
  assert.equal(check.status, "fail");
  assert.match(check.action, /none, ollama, or gemini/u);
});

test("browser environment override takes precedence over configuration", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doctor-browser-"));
  const configuredPath = path.join(directory, "configured-browser");
  const environmentPath = path.join(directory, "environment-browser");
  await fs.writeFile(configuredPath, "");
  await fs.writeFile(environmentPath, "");
  await fs.chmod(configuredPath, 0o755);
  await fs.chmod(environmentPath, 0o755);

  const browser = await resolveBrowser({ configuredPath, environmentPath });

  assert.equal(browser.path, environmentPath);
});

for (const [status, expectedCode] of [
  ["ready", 0],
  ["blocked", 1],
  ["ready-with-warnings", 2],
]) {
  test(`doctor CLI maps ${status} to exit code ${expectedCode}`, async () => {
    const code = await runDoctorCli([], {
      run: async () => ({ status, checks: [] }),
      logger: { log() {}, error() {} },
    });
    assert.equal(code, expectedCode);
  });
}

test("doctor CLI rejects unsupported options before running checks", async () => {
  let ran = false;
  const messages = [];
  const code = await runDoctorCli(["--unknown"], {
    run: async () => {
      ran = true;
    },
    logger: { log() {}, error: (message) => messages.push(message) },
  });
  assert.equal(code, 1);
  assert.equal(ran, false);
  assert.match(messages[0], /Unknown option/u);
});
