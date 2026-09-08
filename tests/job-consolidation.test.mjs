import test from "node:test";
import assert from "node:assert/strict";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { consolidateExtraction } from "../lib/job-parser/consolidate-extraction.mjs";
import { validateCoverage } from "../lib/job-parser/coverage.mjs";

const item = (value, quote, sourceUnitIds, examples) => ({
  type: "item", kind: "requirement", classification: "required", value,
  evidence: { quote }, sourceUnitIds, ...(examples ? { examples: examples.map(value => ({ value })) } : {}),
});

test("consolidates only exact same-section records and remaps coverage", () => {
  const document = preprocess("Requirements\n- Node.js\n- Node.js");
  const [first, second] = document.sections[0].units;
  const extraction = { items: [
    item("Node.js", "Node.js", [first.id], ["nodejs"]),
    item("Node.js", "Node.js", [second.id], ["Node.js"]),
  ], coverage: [
    { unitId: first.id, status: "extracted", itemIndices: [0] },
    { unitId: second.id, status: "extracted", itemIndices: [1] },
  ] };
  const result = consolidateExtraction(document, extraction);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].sourceUnitIds, [first.id, second.id]);
  assert.deepEqual(result.items[0].examples, [{ value: "nodejs" }, { value: "Node.js" }]);
  assert.deepEqual(result.coverage.map(entry => entry.itemIndices), [[0], [0]]);
  assert.equal(validateCoverage(document, result).valid, true);
  assert.equal(extraction.items.length, 2);
});

test("does not merge similar values, different evidence, or records across sections", () => {
  const document = preprocess("Requirements\n- Java experience\n\nPreferred Qualifications\n- Java experience\n- 4 years of Java experience");
  const [required] = document.sections[0].units;
  const [preferred, duration] = document.sections[1].units;
  const extraction = { items: [
    item("Java experience", "Java experience", [required.id]),
    { ...item("Java experience", "Java experience", [preferred.id]), classification: "preferred" },
    item("4 years of Java experience", "4 years of Java experience", [duration.id]),
  ] };
  assert.equal(consolidateExtraction(document, extraction).items.length, 3);
});
