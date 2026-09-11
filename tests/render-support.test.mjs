import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRenderArguments } from "../lib/render/arguments.mjs";
import {
  findExecutableOnPath,
  resolveBrowserExecutable,
} from "../lib/render/browser.mjs";
import { ensureOutputDirectory } from "../lib/render/output-directory.mjs";

test("render arguments preserve the positional theme and output directory", () => {
  assert.deepEqual(
    parseRenderArguments([
      "resume.json",
      "jsonresume-theme-test",
      "--output-dir",
      "output",
    ]),
    {
      resumePath: "resume.json",
      theme: "jsonresume-theme-test",
      outputDirectory: "output",
    }
  );
});

for (const argumentsList of [
  ["resume.json", "--output-dir"],
  ["resume.json", "--output-dir", "--unknown"],
  ["resume.json", "--output-dir", "one", "--output-dir", "two"],
  ["resume.json", "--unknown"],
]) {
  test(`render arguments reject ${JSON.stringify(argumentsList)}`, () => {
    assert.throws(() => parseRenderArguments(argumentsList));
  });
}

test("an invalid explicit browser does not silently fall back", () => {
  const resolved = resolveBrowserExecutable({
    configuredPath: "/missing/configured-browser",
    managedPath: "/valid/managed-browser",
    inspect: (candidate) => candidate === "/valid/managed-browser",
  });
  assert.equal(resolved.available, false);
  assert.equal(resolved.source, "configuration");
});

test("browser environment configuration has highest precedence", () => {
  const resolved = resolveBrowserExecutable({
    environmentPath: "/environment-browser",
    configuredPath: "/configured-browser",
    managedPath: "/managed-browser",
    inspect: () => true,
  });
  assert.equal(resolved.path, "/environment-browser");
  assert.equal(resolved.source, "environment");
});

test("PATH lookup ignores files that are not executable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doctor-path-"));
  const candidate = path.join(directory, "ollama");
  await fs.writeFile(candidate, "");
  await fs.chmod(candidate, 0o644);
  assert.equal(
    findExecutableOnPath("ollama", {
      env: { PATH: directory },
      platform: "darwin",
    }),
    null
  );
});

test("render output directory errors include the target path and preserve the cause", async () => {
  const cause = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  await assert.rejects(
    () =>
      ensureOutputDirectory("/protected/output", {
        mkdir: async () => {
          throw cause;
        },
      }),
    (error) => {
      assert.match(error.message, /\/protected\/output/u);
      assert.match(error.message, /permission denied/u);
      assert.equal(error.cause, cause);
      return true;
    }
  );
});
