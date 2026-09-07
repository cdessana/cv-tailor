import fs from "node:fs/promises";
import Ajv from "ajv";

const schema = JSON.parse(await fs.readFile(new URL("../../schemas/job.schema.json", import.meta.url), "utf8"));
const validate = new Ajv({ strict: true, allErrors: true }).compile({
  ...schema.properties.alternativeRequirements, definitions: schema.definitions,
});
export function validateAlternatives(groups = []) {
  if (!validate(groups)) throw new TypeError(`Invalid alternative requirements: ${JSON.stringify(validate.errors)}`);
  return groups;
}

const choiceSignal = /\b(?:or|ou|either|one of|at least one|one or more|and\/or|equivalent experience)\b/iu;
const descriptiveOr = /\b(?:organizations?|compan(?:y|ies))\s+(?:or|ou)\s+(?:organizations?|compan(?:y|ies))\b/iu;

export function isDescriptiveOr(value) {
  return descriptiveOr.test(value) && !/\b(?:one of|either|at least one|equivalent experience)\b/iu.test(value);
}

export function validateAlternativeSemantics(group) {
  if (!choiceSignal.test(group.context)) {
    throw new TypeError("Alternative evidence does not contain an explicit choice signal.");
  }
  if (group.kind === "responsibility") {
    throw new TypeError("Technology or qualification alternatives cannot be responsibilities.");
  }
  if (isDescriptiveOr(group.context)) {
    throw new TypeError("Descriptive OR wording is not a requirement alternative.");
  }
  return group;
}

// Preserve source order for ties. Related evidence is never promoted to strong.
export function evaluateAlternative(group, evaluate) {
  const rank = { exact: 3, equivalent: 2, related: 1, missing: 0 };
  const options = group.values.map(evaluate);
  const best = options.reduce((best, next) => rank[next.status] > rank[best.status] ? next : best);
  return { ...best,
    term: best.status === "missing" ? group.context : best.term,
    alternative: { ...group, selectedOption: best.status === "missing" ? null : best.term },
  };
}
