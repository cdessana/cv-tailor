import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeDirectAlternatives } from "../lib/job-parser/canonicalize-alternatives.mjs";
import { semanticExtract } from "../lib/job-parser/semantic-extract.mjs";

const item = value => ({
  type: "item", kind: "skill", classification: "required", value,
  evidence: { quote: `Experience with ${value}.` }, sourceUnitIds: ["unit-1"],
});

test("canonicalizes only a standalone direct technology choice", () => {
  const source = { items: [item("PostgreSQL or MySQL")] };
  const result = canonicalizeDirectAlternatives(source);
  assert.deepEqual(result.items[0], {
    type: "alternative", operator: "anyOf", kind: "skill", classification: "required",
    values: ["PostgreSQL", "MySQL"], evidence: source.items[0].evidence, sourceUnitIds: ["unit-1"],
  });
  assert.deepEqual(source.items[0], item("PostgreSQL or MySQL"));
});

test("semantic extraction validates a canonicalized direct choice before mapping", async () => {
  const value = "PostgreSQL or MySQL";
  const extraction = await semanticExtract({ originalText: `Experience with ${value}.`, sections: [] }, { items: [] }, async () => ({ items: [item(value)] }));
  assert.equal(extraction.items[0].type, "alternative");
  assert.deepEqual(extraction.items[0].values, ["PostgreSQL", "MySQL"]);
});

for (const value of [
  "6 years of experience as a Backend or Integration Software Engineer",
  "Degree or equivalent",
  "Experience with Java, Kotlin or Scala",
]) test(`does not guess a structured choice from prose: ${value}`, () => {
  assert.equal(canonicalizeDirectAlternatives({ items: [item(value)] }).items[0].type, "item");
});


test("leaves malformed records for structural validation instead of throwing", () => {
  const result = canonicalizeDirectAlternatives({ items: [null] });
  assert.deepEqual(result.items, [null]);
});


test("leaves malformed roots for structural validation instead of throwing", () => {
  assert.deepEqual(canonicalizeDirectAlternatives({ items: "not-an-array" }), { items: "not-an-array" });
  assert.equal(canonicalizeDirectAlternatives(null), null);
});
