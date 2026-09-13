import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAlternative, validateAlternatives, validateAlternativeSemantics } from "../lib/job-requirements/alternatives.mjs";
const group = { operator: "anyOf", kind: "skill", classification: "required", values: ["Java", "Kotlin"], context: "Java or Kotlin" };
for (const statuses of [["missing", "exact"], ["exact", "exact"], ["related", "missing"], ["missing", "missing"]]) {
  test(`group evaluation ${statuses}`, () => {
    const result = evaluateAlternative(group, (term) => ({ term, status: statuses[group.values.indexOf(term)], evidence: [] }));
    assert.equal(result.status, statuses.includes("exact") ? "exact" : statuses.includes("related") ? "related" : "missing");
    assert.deepEqual(result.alternative.values, group.values);
    assert.equal(result.alternative.selectedOption, result.status === "missing" ? null : result.term);
  });
}
for (const change of [{ values: [] }, { values: ["Java"] }, { values: ["Java", "Java"] }, { values: ["Java", 1] }, { values: ["Java", " "] }, { operator: "allOf" }, { classification: "ambiguous" }, { context: "" }, { extra: true }]) {
  test(`invalid group ${JSON.stringify(change)}`, () => assert.throws(() => validateAlternatives([{ ...group, ...change }]), /Invalid alternative/));
}
test("optional groups and preferred groups are valid", () => {
  assert.deepEqual(validateAlternatives(), []);
  assert.doesNotThrow(() => validateAlternatives([{ ...group, classification: "preferred" }]));
});
test("plural organization wording is descriptive", () => {
  assert.throws(() => validateAlternativeSemantics({ ...group, context: "fast-moving organizations or companies" }), /Descriptive OR/);
});

test("partner-or-customer wording is descriptive", () => {
  assert.throws(() => validateAlternativeSemantics({ ...group, context: "working directly with external partners or customers" }), /Descriptive OR/);
});
