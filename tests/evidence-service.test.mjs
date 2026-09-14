import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const originalCwd = process.cwd();
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cv-tailor-evidence-"));
await fs.mkdir(path.join(workspace, "data", "resumes"), { recursive: true });
await fs.writeFile(
  path.join(workspace, "data", "evidence.json"),
  JSON.stringify({ version: 2, skills: {}, experiences: [] }),
);
await fs.writeFile(
  path.join(workspace, "data", "resumes", "base.json"),
  JSON.stringify({ skills: [] }),
);
process.chdir(workspace);

const evidence = await import("../server/services/evidence-service.mjs");

test.after(async () => {
  process.chdir(originalCwd);
  await fs.rm(workspace, { recursive: true, force: true });
});

test("evidence builder stores reviewed claims before they become ground truth", async () => {
  const queued = await evidence.submitToReviewQueue({
    company: "Acme",
    position: "Backend Engineer",
    period: "2024-01 — Present",
    facts: ["Built a reliable API gateway."],
    skills: ["Node.js"],
  });

  assert.equal(queued.status, "pending");
  assert.equal((await evidence.loadEvidence()).experiences.length, 0);

  const approved = await evidence.approveQueueItem(queued.id);
  assert.equal(approved.success, true);

  const catalog = await evidence.getEvidenceCatalog({ skill: "node.js" });
  assert.equal(catalog.filteredCount, 1);
  assert.deepEqual(catalog.experiences[0].facts, ["Built a reliable API gateway."]);
});

test("evidence import validation rejects duplicate IDs and malformed facts", () => {
  assert.throws(() => evidence.validateEvidenceStructure({
    version: 2,
    skills: {},
    experiences: [
      { id: "same", company: "Acme", facts: ["A fact"] },
      { id: "same", company: "Beta", facts: ["Another fact"] },
    ],
  }), /duplicated/);

  assert.throws(() => evidence.validateEvidenceStructure({
    version: 2,
    skills: {},
    experiences: [{ id: "bad", company: "Acme", facts: [42] }],
  }), /non-empty strings/);
});
