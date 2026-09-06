import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv";

const readJson = async (relativePath) =>
  JSON.parse(await fs.readFile(new URL(relativePath, import.meta.url), "utf8"));

// Synchronous compilation uses bundled Draft-07 metadata and local references.
// No remote schema loader or data-repair options are enabled.
const ajv = new Ajv({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
const parserSchema = await readJson("../schemas/job-parser.schema.json");
const jobSchema = await readJson("../schemas/job.schema.json");
const validateParser = ajv.compile(parserSchema);
const validateJob = ajv.compile(jobSchema);
const fixture = await readJson("../data/jobs/flash-senior-backend.json");

function check(name, validate, value, expected) {
  test(name, () => {
    const before = structuredClone(value);
    assert.equal(validate(value), expected, JSON.stringify(validate.errors));
    assert.deepEqual(value, before, "Validation must not modify input");
  });
}

const item = {
  type: "item",
  value: "Node.js",
  kind: "skill",
  classification: "required",
  evidence: { quote: "Experience with Node.js is required" },
  sourceSection: "Requirements",
};
const alternative = {
  type: "alternative",
  operator: "anyOf",
  values: ["AWS", "GCP", "Azure"],
  kind: "skill",
  classification: "required",
  evidence: { quote: "Experience with AWS, GCP, or Azure is required" },
};
const metadata = {
  company: { value: "Example", evidence: { quote: "Join Example" } },
  title: { value: "Engineer", evidence: { quote: "Engineer position" } },
  location: { value: "Remote", evidence: { quote: "Remote role" } },
  employmentType: {
    value: "Full-time",
    evidence: { quote: "Full-time employment" },
  },
  sourceUrl: {
    value: "https://example.com/job",
    evidence: { quote: "https://example.com/job" },
    sourceSection: "Application",
  },
};
const extraction = { metadata, items: [item, alternative] };

check("intermediate: metadata absent", validateParser, { items: [] }, true);
check(
  "intermediate: metadata empty",
  validateParser,
  { metadata: {}, items: [] },
  true
);
check(
  "intermediate: metadata partial",
  validateParser,
  {
    metadata: { company: metadata.company },
    items: [item],
  },
  true
);
check(
  "intermediate: metadata complete and OR group",
  validateParser,
  extraction,
  true
);
const withoutSection = structuredClone(item);
delete withoutSection.sourceSection;
check(
  "intermediate: source section optional",
  validateParser,
  { items: [withoutSection] },
  true
);

const examples = {
  skill: "Node.js",
  requirement: "Five years of engineering experience",
  competency: "Communication",
  responsibility: "Mentor engineers",
  ambiguous: "Exposure to cloud services",
};
const allowed = {
  skill: ["required", "preferred", "ambiguous"],
  requirement: ["required", "preferred", "ambiguous"],
  competency: ["required", "preferred", "ambiguous"],
  responsibility: ["not-applicable"],
  ambiguous: ["ambiguous"],
};
for (const [kind, value] of Object.entries(examples)) {
  for (const classification of [
    "required",
    "preferred",
    "ambiguous",
    "not-applicable",
  ]) {
    for (const shape of [item, alternative]) {
      const entry = { ...shape, kind, classification };
      if (shape.type === "item") {
        entry.value = value;
        entry.evidence = { quote: value };
      }
      check(
        `intermediate: ${shape.type} ${kind}/${classification}`,
        validateParser,
        { items: [entry] },
        allowed[kind].includes(classification)
      );
    }
  }
}

function changed(original, path, value, remove = false) {
  const result = structuredClone(original);
  const parent = path
    .slice(0, -1)
    .reduce((current, key) => current[key], result);
  if (remove) delete parent[path.at(-1)];
  else parent[path.at(-1)] = value;
  return result;
}

for (const path of [
  ["unexpected"],
  ["metadata", "unexpected"],
  ["metadata", "company", "unexpected"],
  ["metadata", "company", "evidence", "unexpected"],
  ["items", 0, "unexpected"],
  ["items", 0, "evidence", "unexpected"],
  ["items", 1, "unexpected"],
  ["items", 1, "evidence", "unexpected"],
]) {
  check(
    `intermediate: rejects extra ${path.join(".")}`,
    validateParser,
    changed(extraction, path, true),
    false
  );
}
for (const path of [
  ["items"],
  ["metadata", "company", "value"],
  ["metadata", "company", "evidence"],
  ["metadata", "company", "evidence", "quote"],
  ...["type", "value", "kind", "classification", "evidence"].map((key) => [
    "items",
    0,
    key,
  ]),
  ["items", 0, "evidence", "quote"],
  ...["type", "operator", "values", "kind", "classification", "evidence"].map(
    (key) => ["items", 1, key]
  ),
]) {
  check(
    `intermediate: requires ${path.join(".")}`,
    validateParser,
    changed(extraction, path, undefined, true),
    false
  );
}
for (const [path, values] of [
  [["metadata"], [null, [], "Example"]],
  [
    ["metadata", "company"],
    [null, "Example"],
  ],
  [
    ["metadata", "company", "value"],
    [null, 123, "", " \n\t"],
  ],
  [
    ["metadata", "company", "evidence", "quote"],
    [null, 123, "", "  "],
  ],
  [["items"], [null, {}, "Node.js"]],
  [
    ["items", 0],
    [null, "Node.js"],
  ],
  [
    ["items", 0, "value"],
    [null, 123, "", " \n\t"],
  ],
  [
    ["items", 0, "kind"],
    [null, "technology"],
  ],
  [
    ["items", 0, "classification"],
    [null, "mandatory"],
  ],
  [
    ["items", 0, "evidence"],
    [null, "Experience with Node.js"],
  ],
  [
    ["items", 0, "evidence", "quote"],
    [null, 123, "", "  "],
  ],
  [
    ["items", 0, "sourceSection"],
    [null, 123, "", "  "],
  ],
  [
    ["items", 1, "operator"],
    [null, "allOf"],
  ],
  [
    ["items", 1, "values"],
    [
      null,
      "AWS or GCP",
      [],
      ["AWS"],
      ["AWS", "AWS"],
      ["AWS", ""],
      ["AWS", "  "],
      ["AWS", 123],
      ["AWS", { value: "GCP" }],
    ],
  ],
]) {
  for (const value of values) {
    check(
      `intermediate: rejects ${path.join(".")}=${JSON.stringify(value)}`,
      validateParser,
      changed(extraction, path, value),
      false
    );
  }
}
check(
  "intermediate: item cannot also contain alternatives",
  validateParser,
  { items: [{ ...item, values: ["Node.js", "Java"] }] },
  false
);
check(
  "intermediate: alternative cannot also contain a single value",
  validateParser,
  { items: [{ ...alternative, value: "AWS" }] },
  false
);

const minimalJob = { company: "Example", title: "Engineer" };
check("final: existing fixture unchanged", validateJob, fixture, true);
check("final: company/title only", validateJob, minimalJob, true);
check(
  "final: partial source and metadata",
  validateJob,
  {
    ...minimalJob,
    source: { url: "https://example.com/job" },
    metadata: { language: "en" },
  },
  true
);
check(
  "final: empty optional containers",
  validateJob,
  {
    ...minimalJob,
    source: {},
    metadata: {},
    requirements: {},
    responsibilities: [],
    qualifications: [],
    skills: [],
    screening: [],
  },
  true
);
check(
  "final: values are not fixture-derived enums",
  validateJob,
  {
    ...fixture,
    type: "Contract",
    remote: "Hybrid",
    screening: [{ topic: "Availability", type: "text" }],
    metadata: { language: "en", status: "draft" },
  },
  true
);
check(
  "final: separate responsibilities and duplicate requirements",
  validateJob,
  {
    ...minimalJob,
    responsibilities: ["Mentor engineers"],
    requirements: { required: ["Node.js", "Node.js"] },
  },
  true
);

for (const validate of [validateParser, validateJob]) {
  for (const root of [null, [], "job", 123, true]) {
    check(
      `${validate === validateParser ? "intermediate" : "final"}: rejects root ${JSON.stringify(root)}`,
      validate,
      root,
      false
    );
  }
}
for (const path of [
  ["company"],
  ["title"],
  ["skills", 0, "name"],
  ["skills", 0, "keywords"],
  ["screening", 0, "topic"],
  ["screening", 0, "type"],
]) {
  check(
    `final: requires ${path.join(".")}`,
    validateJob,
    changed(fixture, path, undefined, true),
    false
  );
}
for (const path of [
  ["unexpected"],
  ["confidence"],
  ["required"],
  ["preferred"],
  ["competencies"],
  ["location"],
  ["employmentType"],
  ["url"],
  ["source", "unexpected"],
  ["metadata", "unexpected"],
  ["requirements", "unexpected"],
  ["skills", 0, "unexpected"],
  ["screening", 0, "unexpected"],
]) {
  check(
    `final: rejects extra ${path.join(".")}`,
    validateJob,
    changed(fixture, path, []),
    false
  );
}
for (const path of [
  ["company"],
  ["title"],
  ["type"],
  ["remote"],
  ["description"],
  ["source", "platform"],
  ["source", "url"],
  ["source", "applicationUrl"],
  ["metadata", "language"],
  ["metadata", "status"],
  ["skills", 0, "name"],
  ["screening", 0, "topic"],
  ["screening", 0, "type"],
]) {
  for (const value of [null, 123, "", " \n\t"]) {
    check(
      `final: rejects ${path.join(".")}=${JSON.stringify(value)}`,
      validateJob,
      changed(fixture, path, value),
      false
    );
  }
}
for (const key of ["source", "metadata", "requirements"]) {
  for (const value of [null, [], "bad", 123]) {
    check(
      `final: rejects ${key}=${JSON.stringify(value)}`,
      validateJob,
      { ...fixture, [key]: value },
      false
    );
  }
}
for (const path of [
  ...["required", "preferred", "competencies"].map((key) => [
    "requirements",
    key,
  ]),
  ["responsibilities"],
  ["qualifications"],
  ["skills", 0, "keywords"],
  ["screening", 1, "keywords"],
]) {
  for (const value of [
    null,
    "Node.js",
    {},
    [123],
    [null],
    [""],
    ["  "],
    [{ type: "alternative", values: ["AWS", "GCP"] }],
  ]) {
    check(
      `final: rejects ${path.join(".")}=${JSON.stringify(value)}`,
      validateJob,
      changed(fixture, path, value),
      false
    );
  }
}
for (const key of ["skills", "screening"]) {
  for (const value of [null, {}, "bad", [null], [123], [{}]]) {
    check(
      `final: rejects ${key}=${JSON.stringify(value)}`,
      validateJob,
      { ...fixture, [key]: value },
      false
    );
  }
}
