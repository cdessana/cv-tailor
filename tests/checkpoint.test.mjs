import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCheckpoint,
  executionIdentity,
  readCheckpoint,
  removeCheckpoint,
  writeCheckpoint,
} from "../lib/job-parser/providers/checkpoint.mjs";

test("checkpoint round-trips atomically and resumes only matching executions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cv-checkpoint-"));
  const file = path.join(directory, "run.json");
  const identity = executionIdentity({ inputText: "job", provider: "ollama", model: "m" });
  await writeCheckpoint(file, createCheckpoint(identity, { pending: ["b"], accepted: ["a"] }));
  assert.deepEqual((await readCheckpoint(file, identity)).pending, ["b"]);
  assert.equal(await readCheckpoint(file, { ...identity, model: "other" }), null);
  await removeCheckpoint(file);
  assert.equal(await readCheckpoint(file, identity), null);
  await fs.rm(directory, { recursive: true, force: true });
});

test("corrupt checkpoints are ignored", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cv-checkpoint-"));
  const file = path.join(directory, "run.json");
  await fs.writeFile(file, "not json");
  assert.equal(await readCheckpoint(file, executionIdentity({ inputText: "x", provider: "ollama" })), null);
  await fs.rm(directory, { recursive: true, force: true });
});
