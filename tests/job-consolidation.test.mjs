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

test("preserves non-enumerable provider metrics", () => {
  const document = preprocess("Requirements\n- Node.js");
  const [unit] = document.sections[0].units;
  const extraction = { items: [item("Node.js", "Node.js", [unit.id])], coverage: [{ unitId: unit.id, status: "extracted", itemIndices: [0] }] };
  Object.defineProperty(extraction, "providerReport", { value: { completed: 2 }, enumerable: false });
  const result = consolidateExtraction(document, extraction);
  assert.deepEqual(result.providerReport, { completed: 2 });
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

test("keeps the more detailed repeated duration-and-technology requirement across sections", () => {
  const document = preprocess("Overview\n- 4+ years of Java experience\n\nMust haves\n- At least 4+ years of experience in backend development using Java");
  const [overview] = document.sections[0].units;
  const [detail] = document.sections[1].units;
  const extraction = { items: [
    item("4+ years of Java experience", "4+ years of Java experience", [overview.id]),
    item("At least 4+ years of experience in backend development using Java", "At least 4+ years of experience in backend development using Java", [detail.id]),
  ], coverage: [
    { unitId: overview.id, status: "extracted", itemIndices: [0] },
    { unitId: detail.id, status: "extracted", itemIndices: [1] },
  ] };
  const result = consolidateExtraction(document, extraction);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].value, "At least 4+ years of experience in backend development using Java");
  assert.deepEqual(result.items[0].sourceUnitIds, [overview.id, detail.id]);
  assert.deepEqual(result.coverage.map(entry => entry.itemIndices), [[0], [0]]);
});
