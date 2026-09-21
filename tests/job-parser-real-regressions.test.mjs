import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runJobParser } from "../scripts/job-parser.mjs";

const rawDirectory = path.resolve("tmp/jobs-descriptions");

async function rawFile(prefix) {
  const names = await fs.readdir(rawDirectory);
  const name = names.find((entry) => entry.startsWith(prefix));
  assert.ok(name, `Missing supplied regression fixture with prefix ${prefix}`);
  return path.join(rawDirectory, name);
}

async function parseFixture(prefix, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "job-parser-real-"));
  const input = await rawFile(prefix);
  const output = path.join(directory, "job.json");
  return runJobParser({ input, output, semanticProviderName: "none", ...options });
}

test("Stripe keeps structural responsibilities and qualifications without enrichment", async () => {
  const { job } = await parseFixture("Stripe_");
  assert.ok(job.responsibilities?.length);
  assert.ok(job.requirements?.required?.length);
  assert.ok(job.requirements?.preferred?.length);
  assert.ok(!job.responsibilities.some((value) => /Sao Paulo-based team|US and Europe/iu.test(value)));
});

test("BairesDev preserves Portuguese structured requirements and responsibilities", async () => {
  const { job } = await parseFixture("BairesDev_");
  assert.ok(job.responsibilities?.length);
  assert.ok(job.requirements?.required?.some((value) => /ASP\.NET|\.NET Core/iu.test(value)));
  assert.ok(!JSON.stringify(job).includes("--------------------------------------------------------------------------------"));
});

test("Azion preserves Rust/C++ wording without inventing a choice", async () => {
  const { job } = await parseFixture("Azion_");
  const values = [...(job.requirements?.required ?? []), ...(job.requirements?.preferred ?? [])];
  assert.ok(values.some((value) => /Rust.*C\/C\+\+|C\/C\+\+.*Rust/iu.test(value)));
});

test("Bradesco and zerohash parse their deterministic section content", async () => {
  const [{ job: bradesco }, { job: zerohash }] = await Promise.all([
    parseFixture("Banco_Bradesco_"),
    parseFixture("zerohash_"),
  ]);
  assert.ok(bradesco.responsibilities?.length);
  assert.ok(bradesco.requirements?.required?.length);
  assert.ok(zerohash.responsibilities?.length);
  assert.ok(zerohash.requirements?.required?.length);
});

test("BTG is a clean deterministic structured vacancy", async () => {
  const { job } = await parseFixture("BTG_Pactual_");
  assert.ok(job.responsibilities?.length);
  assert.ok(job.company && job.title);
});

test("Inter squashed markup, IQVIA requirements, and NTT mixed prose remain usable", async () => {
  const [{ job: inter }, { job: iqvia }, { job: ntt }] = await Promise.all([
    parseFixture("Inter_"),
    parseFixture("IQVIA_"),
    parseFixture("NTT_DATA_"),
  ]);
  assert.ok(inter.responsibilities?.length);
  assert.ok(inter.requirements?.required?.length);
  assert.ok(iqvia.requirements?.required?.length || iqvia.requirements?.preferred?.length);
  assert.ok(![...(iqvia.requirements?.required ?? []), ...(iqvia.requirements?.preferred ?? [])]
    .some((value) => /^(?:our|the)\s+(?:main\s+)?stack|we use/iu.test(value)));
  // NTT's Activities prose is intentionally an ambiguous-enrichment case; a
  // valid structural job with identification metadata is the required fallback.
  assert.ok(ntt.company && ntt.title);
});

test("real parser entry point retains structured jobs when enrichment fails", async () => {
  let calls = 0;
  const failingProvider = async () => {
    calls += 1;
    throw new Error("Ollama unavailable");
  };
  const results = await Promise.all([
    parseFixture("Stripe_", { semanticProvider: failingProvider }),
    parseFixture("BairesDev_", { semanticProvider: failingProvider }),
    parseFixture("Azion_", { semanticProvider: failingProvider }),
    parseFixture("Banco_Bradesco_", { semanticProvider: failingProvider }),
    parseFixture("zerohash_", { semanticProvider: failingProvider }),
    parseFixture("BTG_Pactual_", { semanticProvider: failingProvider }),
  ]);
  for (const result of results) {
    assert.ok(result.job.company && result.job.title);
    assert.ok(result.warnings.every((warning) =>
      warning.code === "semantic_enrichment_failed" ||
      warning.code === "ambiguous_metadata"
    ));
  }
  // Azion, zerohash, and BTG have no unresolved units and never call the
  // provider. The remaining fixtures retain their deterministic job when it
  // fails, proving the public entry point degrades gracefully.
  assert.equal(calls, 3);
});
