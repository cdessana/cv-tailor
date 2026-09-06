import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  aliasComparisonKey,
  validateParserAliases,
} from "../lib/job-parser/validate-aliases.mjs";

const dictionary = JSON.parse(
  await fs.readFile(
    new URL("../data/parser-aliases.json", import.meta.url),
    "utf8"
  )
);
function check(name, value, valid, code) {
  test(name, () => {
    const before = structuredClone(value);
    const result = validateParserAliases(value);
    assert.equal(result.valid, valid, JSON.stringify(result.errors));
    assert.deepEqual(value, before);
    if (code) assert.ok(result.errors.some((error) => error.code === code));
    if (valid) assert.deepEqual(result.errors, []);
  });
}
check("reviewed dictionary", dictionary, true);
check("empty dictionary", {}, true);
check(
  "canonical-only and new dynamic keys",
  { "Example Tech": [], "Other+": ["Other Plus"] },
  true
);
for (const value of [null, [], "dictionary", 123, true])
  check(`root ${JSON.stringify(value)}`, value, false, "schema");
for (const value of [null, {}, "alias", 123, [null], [123], [{}], [[]]])
  check(`value ${JSON.stringify(value)}`, { Example: value }, false, "schema");
for (const spelling of [
  "",
  " ",
  " Node",
  "Node ",
  "Two  Words",
  "Two\tWords",
  "Two\nWords",
  "Two\u00a0Words",
  "Node\n",
]) {
  check(
    `bad key ${JSON.stringify(spelling)}`,
    { [spelling]: [] },
    false,
    "schema"
  );
  check(
    `bad alias ${JSON.stringify(spelling)}`,
    { Example: [spelling] },
    false,
    "schema"
  );
}
check("exact duplicates", { Example: ["Alias", "Alias"] }, false, "schema");
check(
  "case duplicate aliases",
  { Example: ["Alias", "ALIAS"] },
  false,
  "duplicate"
);
check(
  "implicit canonical duplicate",
  { "Node.js": ["node.JS"] },
  false,
  "duplicate"
);
check("canonical collision", { Example: [], EXAMPLE: [] }, false, "collision");
check(
  "canonical-to-alias",
  { Example: [], Other: ["EXAMPLE"] },
  false,
  "collision"
);
check(
  "alias-to-canonical",
  { Other: ["EXAMPLE"], Example: [] },
  false,
  "collision"
);
check(
  "alias-to-alias",
  { Example: ["Shared"], Other: ["SHARED"] },
  false,
  "collision"
);
check(
  "punctuation and accents remain distinct",
  { "C++": [], "C#": [], Cafe: [], Café: [] },
  true
);
check(
  "prototype-like names have no special lookup behavior",
  JSON.parse('{"__proto__":[],"constructor":[],"toString":[]}'),
  true
);

test("errors identify both locations and survive subsequent validations", () => {
  const result = validateParserAliases({
    "A/B": ["Shared"],
    "C~D": ["SHARED"],
  });
  assert.deepEqual(result.errors[0], {
    code: "collision",
    key: "shared",
    first: {
      canonical: "A/B",
      spelling: "Shared",
      path: "/A~1B/0",
      role: "alias",
    },
    second: {
      canonical: "C~D",
      spelling: "SHARED",
      path: "/C~0D/0",
      role: "alias",
    },
  });
  const saved = structuredClone(result);
  validateParserAliases(dictionary);
  assert.deepEqual(result, saved);
});

test("comparison handles whitespace and case only", () => {
  assert.equal(
    aliasComparisonKey(" \tGOOGLE\n Cloud  Platform\u00a0"),
    "google cloud platform"
  );
  assert.equal(aliasComparisonKey("Node.JS"), "node.js");
  assert.notEqual(aliasComparisonKey("Café"), aliasComparisonKey("Cafe"));
  assert.notEqual(aliasComparisonKey("Ｎode"), aliasComparisonKey("Node"));
  assert.notEqual(aliasComparisonKey("C++"), aliasComparisonKey("C#"));
  assert.notEqual(
    aliasComparisonKey("Mentored"),
    aliasComparisonKey("Mentoring")
  );
  assert.notEqual(
    aliasComparisonKey("Experience with NodeJS"),
    aliasComparisonKey("NodeJS")
  );
  assert.throws(() => aliasComparisonKey(123), TypeError);
});

// Test dictionary ownership, not a runtime normalizer or extraction path.
function owners(spelling) {
  return Object.entries(dictionary)
    .filter(([canonical, aliases]) =>
      [canonical, ...aliases].some(
        (value) => aliasComparisonKey(value) === aliasComparisonKey(spelling)
      )
    )
    .map(([canonical]) => canonical);
}
for (const [spelling, canonical] of [
  ["nodejs", "Node.js"],
  ["node.js", "Node.js"],
  ["k8s", "Kubernetes"],
  ["postgres", "PostgreSQL"],
  ["Mongo DB", "MongoDB"],
  ["DDD", "Domain-Driven Design"],
  ["Google Cloud Platform", "GCP"],
  ["REST API", "REST APIs"],
  ["Test Automation", "Automated Testing"],
]) {
  test(`approved ownership: ${spelling}`, () =>
    assert.deepEqual(owners(spelling), [canonical]));
}
for (const [spelling, prohibited] of [
  ["cloud", "AWS"],
  ["JVM", "Java"],
  ["CI/CD", "GitHub Actions"],
  ["GitHub Actions", "CI/CD"],
  ["GitLab CI", "CI/CD"],
  ["gRPC", "RPC"],
  ["Distributed Systems", "Scalable Systems"],
  ["Node", "Node.js"],
]) {
  test(`prohibited ownership: ${spelling} to ${prohibited}`, () =>
    assert.ok(!owners(spelling).includes(prohibited)));
}
for (const spelling of [
  "UnknownTech",
  "Experience with NodeJS",
  "Node",
  "cloud",
  "JVM",
  "GitHub Actions",
  "gRPC",
]) {
  test(`unregistered complete value: ${spelling}`, () =>
    assert.deepEqual(owners(spelling), []));
}
