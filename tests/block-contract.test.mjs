import assert from "node:assert/strict";
import test from "node:test";
import Ajv from "ajv";
import {
  canonicalizeBlockRecords,
  createBlockContract,
} from "../lib/job-parser/providers/block-contract.mjs";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { validateEvidence } from "../lib/job-parser/validate-evidence.mjs";
import { semanticExtract } from "../lib/job-parser/semantic-extract.mjs";

const empty = () => ({ items: [], alternatives: [], metadata: {}, reason: "" });
const ordinary = (value) => ({
  type: "item",
  value,
  kind: "requirement",
  classification: "required",
  evidence: { quote: value },
});
const doc = preprocess(
  "Company: Example\nPosition: Engineer\n\nIntroduction\n\nRequirements\n- Java or Kotlin\n- AI fluency\n\nBenefits:\n- Paid leave"
);
const contract = createBlockContract(doc);
const [meta, intro, choice, ai, benefit] = contract.blocks;
const alternative = {
  type: "alternative",
  operator: "anyOf",
  values: ["Java", "Kotlin"],
  kind: "skill",
  classification: "required",
  evidence: { quote: "Java or Kotlin" },
};
const valid = {
  blocks: {
    [meta.id]: {
      ...empty(),
      status: "extracted",
      items: [],
      metadata: {
        company: { value: "Example", evidence: { quote: "Company: Example" } },
        title: { value: "Engineer", evidence: { quote: "Position: Engineer" } },
      },
    },
    [intro.id]: { ...empty(), status: "excluded", reason: "Introduction only" },
    [choice.id]: {
      ...empty(),
      status: "extracted",
      alternatives: [alternative],
    },
    [ai.id]: {
      ...empty(),
      status: "extracted",
      items: [ordinary("AI fluency")],
    },
    [benefit.id]: {
      ...empty(),
      status: "excluded",
      reason: "Paid leave is a benefit",
    },
  },
};

test("blocks colocate IDs/text and preserve document order and heading context", () => {
  assert.equal(meta.text, "Company: Example\nPosition: Engineer");
  assert.equal(choice.heading, "Requirements");
  assert.equal(choice.signal, "required");
  assert.deepEqual(
    contract.schema.properties.blocks.required,
    contract.blocks.map((b) => b.id)
  );
});

test("flags silent exclusion of substantive content under a signaled heading", () => {
  const copy = structuredClone(valid);
  copy.blocks[ai.id] = {
    ...empty(),
    status: "excluded",
    reason: "No explicit job details found",
  };

  assert.deepEqual(
    contract.inspect(copy).map(({ blockId, code }) => ({ blockId, code })),
    [{ blockId: ai.id, code: "suspicious_signaled_exclusion" }]
  );

  copy.blocks[ai.id].status = "unresolved";
  assert.equal(
    contract
      .inspect(copy)
      .some((error) => error.code === "suspicious_signaled_exclusion"),
    false
  );
});

test("permits exclusion of a generic section lead", () => {
  const document = preprocess("Must haves\nWe're looking for someone who meets the minimum requirements to be considered for the role.");
  const [block] = createBlockContract(document).blocks;
  const response = { blocks: { [block.id]: { ...empty(), status: "excluded", reason: "Section introduction" } } };
  assert.equal(createBlockContract(document).inspect(response).some(error => error.code === "suspicious_signaled_exclusion"), false);
});

test("permits exclusion of company hybrid-work policy context", () => {
  const document = preprocess("Nice to haves\nClara is committed to hybrid work, combining remote flexibility with office collaboration.");
  const [block] = createBlockContract(document).blocks;
  const response = { blocks: { [block.id]: { ...empty(), status: "excluded", reason: "Company work policy" } } };
  assert.equal(createBlockContract(document).inspect(response).some(error => error.code === "suspicious_signaled_exclusion"), false);
});

test("permits exclusion of a responsibilities section lead", () => {
  const document = preprocess(
    "Como será seu dia a dia\nComo Software Engineer III, você atuará na área de Cartões e suas principais atividades serão:"
  );
  const [block] = createBlockContract(document).blocks;
  const response = {
    blocks: { [block.id]: { ...empty(), status: "excluded", reason: "Section lead" } },
  };
  assert.deepEqual(createBlockContract(document).inspect(response), []);
});

test("preserves one-or-more qualifications as a complete requirement", () => {
  const document = preprocess("Must haves\n- Strong proficiency in one or more backend languages (preferably Java)");
  const [block] = createBlockContract(document).blocks;
  const response = { blocks: { [block.id]: { ...empty(), status: "excluded", reason: "No requirement found" } } };
  createBlockContract(document).reconcile(response);
  assert.equal(response.blocks[block.id].items[0].value, "Strong proficiency in one or more backend languages (preferably Java)");
});

test("preserves e.g. lists as examples rather than alternatives", () => {
  const value = "Exposure to integration platforms or connector frameworks (e.g. N8N, Zapier, or custom-built equivalents)";
  const document = preprocess(`Must haves\n- ${value}`);
  const [block] = createBlockContract(document).blocks;
  const response = { blocks: { [block.id]: { ...empty(), status: "excluded", reason: "No requirement found" } } };
  createBlockContract(document).reconcile(response);
  assert.equal(response.blocks[block.id].items[0].value, value);
});

test("rejects provider records that contradict the enclosing section signal", () => {
  const copy = structuredClone(valid);
  copy.blocks[ai.id].items[0].classification = "preferred";

  assert.equal(
    contract
      .inspect(copy)
      .some(
        ({ blockId, code }) =>
          blockId === ai.id && code === "section_signal_mismatch"
      ),
    true
  );

  const responsibilityDocument = preprocess(
    "What You’ll Own\n- Develop reliable services"
  );
  const responsibilityContract = createBlockContract(responsibilityDocument);
  const [responsibility] = responsibilityContract.blocks;
  const response = {
    blocks: {
      [responsibility.id]: {
        ...empty(),
        status: "extracted",
        items: [ordinary("Develop reliable services")],
      },
    },
  };
  assert.equal(
    responsibilityContract
      .inspect(response)
      .some(({ code }) => code === "section_signal_mismatch"),
    true
  );
});

test("preserves a safely representable signaled bullet when a provider excludes it", () => {
  const copy = structuredClone(valid);
  copy.blocks[ai.id] = {
    ...empty(),
    status: "excluded",
    reason: "No explicit job details found",
  };
  const changes = [];

  contract.reconcile(copy, (change) => changes.push(change));

  assert.equal(copy.blocks[ai.id].status, "extracted");
  assert.deepEqual(copy.blocks[ai.id].items, [
    {
      type: "item",
      value: "AI fluency",
      kind: "requirement",
      classification: "required",
      evidence: { quote: "- AI fluency" },
      sourceSection: "Requirements",
    },
  ]);
  assert.equal(changes[0].code, "signaled_bullet_preserved");
  assert.equal(contract.inspect(copy).length, 0);
});

test("preserves a qualified explicit choice as an alternative", () => {
  const document = preprocess(
    "Required Qualifications\n• Strong experience in software or systems development using Rust or C/C++;"
  );
  const choiceContract = createBlockContract(document);
  const [block] = choiceContract.blocks;
  const response = {
    blocks: {
      [block.id]: {
        ...empty(),
        status: "excluded",
        reason: "No relevant information found",
      },
    },
  };

  choiceContract.reconcile(response);

  assert.deepEqual(response.blocks[block.id], {
    ...empty(),
    status: "extracted",
    alternatives: [
      {
        type: "alternative",
        operator: "anyOf",
        values: ["Rust", "C/C++"],
        kind: "requirement",
        classification: "required",
        evidence: {
          quote:
            "• Strong experience in software or systems development using Rust or C/C++;",
        },
        sourceSection: "Required Qualifications",
      },
    ],
  });
  assert.equal(choiceContract.inspect(response).length, 0);
  const extraction = choiceContract.assemble(response);
  assert.deepEqual(extraction.items[0].values, ["Rust", "C/C++"]);
});

test("preserves a qualified explicit list choice as an alternative", () => {
  const document = preprocess(
    "Required Qualifications\n• Experience or solid understanding of low-level programming, systems development, or high-performance applications;"
  );
  const listContract = createBlockContract(document);
  const [block] = listContract.blocks;
  const response = {
    blocks: {
      [block.id]: {
        ...empty(),
        status: "excluded",
        reason: "No relevant information found",
      },
    },
  };

  listContract.reconcile(response);

  assert.deepEqual(response.blocks[block.id].alternatives[0].values, [
    "low-level programming",
    "systems development",
    "high-performance applications",
  ]);
  assert.equal(listContract.inspect(response).length, 0);
});

test("preserves longer qualified technology lists as alternatives", () => {
  const document = preprocess(
    "Preferred Qualifications\n• Knowledge or experience with Nginx, OpenResty, Caddy, Envoy, or similar HTTP proxy/cache technologies;"
  );
  const listContract = createBlockContract(document);
  const [block] = listContract.blocks;
  const response = { blocks: { [block.id]: { ...empty(), status: "excluded", reason: "No relevant information found" } } };
  listContract.reconcile(response);
  assert.deepEqual(response.blocks[block.id].alternatives[0].values, [
    "Nginx", "OpenResty", "Caddy", "Envoy", "similar HTTP proxy/cache technologies",
  ]);
});

test("metadata-only and extracted blocks assemble without model references or indexes", async () => {
  const before = structuredClone(valid);
  const extraction = contract.assemble(valid);
  assert.equal(extraction.metadata.title.value, "Engineer");
  assert.deepEqual(extraction.metadata.title.sourceUnitIds, [meta.id]);
  assert.deepEqual(extraction.items[0].sourceUnitIds, [choice.id]);
  assert.deepEqual(extraction.coverage[0], {
    unitId: meta.id,
    status: "metadata",
    metadataKeys: ["company", "title"],
  });
  assert.equal(validateEvidence(doc, extraction).valid, true);
  const merged = await semanticExtract(
    doc,
    { items: [] },
    async () => extraction
  );
  assert.equal(merged.items.length, 2);
  assert.deepEqual(valid, before);
  const reversed = {
    blocks: Object.fromEntries(Object.entries(valid.blocks).reverse()),
  };
  assert.deepEqual(contract.assemble(reversed), extraction);
});

test("losslessly moves a complete alternative placed in items", () => {
  const copy = structuredClone(valid);
  copy.blocks[choice.id].items = [copy.blocks[choice.id].alternatives.pop()];
  const warnings = [];
  canonicalizeBlockRecords(copy, (warning) => warnings.push(warning));
  assert.deepEqual(copy.blocks[choice.id].items, []);
  assert.deepEqual(copy.blocks[choice.id].alternatives, [alternative]);
  assert.equal(warnings[0].code, "misplaced_alternative_canonicalized");
  assert.equal(contract.assemble(copy).items[0].type, "alternative");
});

test("canonicalizes a standalone direct choice before block validation", () => {
  const copy = structuredClone(valid);
  copy.blocks[choice.id].alternatives = [];
  copy.blocks[choice.id].items = [ordinary("Java or Kotlin")];
  canonicalizeBlockRecords(copy);
  assert.equal(copy.blocks[choice.id].items.length, 0);
  assert.deepEqual(copy.blocks[choice.id].alternatives[0].values, [
    "Java",
    "Kotlin",
  ]);
});

test("leaves malformed item records for structural validation", () => {
  const copy = structuredClone(valid);
  copy.blocks[ai.id].items = [null];
  assert.doesNotThrow(() => canonicalizeBlockRecords(copy));
  assert.throws(() => contract.assemble(copy), /Invalid block response/);
});

for (const [name, modify] of [
  ["missing Nortal tail block", (x) => delete x.blocks[benefit.id]],
  [
    "unknown block",
    (x) =>
      (x.blocks.invented = {
        ...empty(),
        status: "excluded",
        reason: "unknown",
      }),
  ],
  [
    "legacy Reap item-index bookkeeping",
    (x) => (x.blocks[ai.id].itemIndices = [22]),
  ],
  [
    "model source IDs",
    (x) => (x.blocks[ai.id].items[0].sourceUnitIds = [meta.id]),
  ],
  ["missing value", (x) => delete x.blocks[ai.id].items[0].value],
  [
    "missing operator",
    (x) => delete x.blocks[choice.id].alternatives[0].operator,
  ],
  ["invalid type", (x) => (x.blocks[ai.id].items[0].value = 4)],
  [
    "unexpected evidence field",
    (x) => (x.blocks[ai.id].items[0].evidence.extra = true),
  ],
])
  test(`actual outgoing schema rejects ${name}`, () => {
    const copy = structuredClone(valid);
    modify(copy);
    const validate = new Ajv({ strict: true }).compile(contract.schema);
    assert.equal(validate(copy), false);
    assert.throws(() => contract.assemble(copy), /Invalid block response/);
  });

for (const [name, modify, pattern] of [
  [
    "wrong kind/classification",
    (x) => (x.blocks[ai.id].items[0].kind = "responsibility"),
    /Invalid intermediate/,
  ],
  [
    "excluded block with items",
    (x) => (x.blocks[benefit.id].items = [ordinary("Paid leave")]),
    /must not contain records/,
  ],
  [
    "title assigned to introduction",
    (x) => {
      x.blocks[intro.id] = {
        ...empty(),
        status: "extracted",
        items: [],
        metadata: x.blocks[meta.id].metadata,
      };
      x.blocks[meta.id] = { ...empty(), status: "excluded", reason: "moved" };
    },
    /Evidence must occur/,
  ],
  [
    "empty extracted result",
    (x) => (x.blocks[ai.id].items = []),
    /no items or metadata/,
  ],
  [
    "blank exclusion",
    (x) => (x.blocks[benefit.id].reason = " "),
    /Invalid intermediate/,
  ],
  [
    "unresolved unit",
    (x) => (x.blocks[benefit.id].status = "unresolved"),
    /must be equal to one of the allowed values/,
  ],
])
  test(`assembly rejects ${name}`, () => {
    const copy = structuredClone(valid);
    modify(copy);
    assert.throws(() => contract.assemble(copy), pattern);
  });

test("correctly placed but paraphrased Reap values still fail evidence validation", () => {
  const source = preprocess(
    "Requirements\n- Data modeling and access: relational databases like Postgres and MySQL"
  );
  const c = createBlockContract(source),
    id = c.blocks[0].id;
  const bad = ordinary("Data modeling and access (Postgres, MySQL)");
  bad.evidence.quote =
    "Data modeling and access: relational databases like Postgres and MySQL";
  const extraction = c.assemble({
    blocks: { [id]: { ...empty(), status: "extracted", items: [bad] } },
  });
  assert.equal(validateEvidence(source, extraction).valid, false);
});

test("empty source permits only empty block results", () => {
  const c = createBlockContract(preprocess(""));
  assert.deepEqual(c.assemble({ blocks: {} }), { items: [], coverage: [] });
});

test("record branches accept supported kinds and reject incompatible classifications", () => {
  const validate = new Ajv({ strict: true }).compile(contract.schema);
  for (const kind of [
    "skill",
    "requirement",
    "competency",
    "responsibility",
    "ambiguous",
  ]) {
    const classification =
      kind === "responsibility"
        ? "not-applicable"
        : kind === "ambiguous"
          ? "ambiguous"
          : "preferred";
    const copy = structuredClone(valid);
    copy.blocks[choice.id].alternatives = [
      { ...alternative, kind, classification },
    ];
    copy.blocks[ai.id].items = [
      { ...ordinary("AI fluency"), kind, classification },
    ];
    assert.equal(validate(copy), true);
  }
});

test("duplicate metadata is accounted for without guessing or overwriting conflicts", () => {
  const source = preprocess("Company: Example\n\nExample is hiring");
  const c = createBlockContract(source),
    [first, second] = c.blocks;
  const block = (quote) => ({
    ...empty(),
    status: "extracted",
    items: [],
    metadata: { company: { value: "Example", evidence: { quote } } },
  });
  const payload = {
    blocks: {
      [first.id]: block("Company: Example"),
      [second.id]: block("Example is hiring"),
    },
  };
  const assembled = c.assemble(payload);
  assert.equal(assembled.metadata.company.value, "Example");
  assert.equal(assembled.coverage.length, 2);
  assert.equal(
    assembled.coverage.filter((x) => x.status === "excluded").length,
    1
  );
  payload.blocks[second.id].metadata.company.value = "hiring";
  const result = c.assemble(payload);
  assert.equal(result.metadata.company.candidates.length, 2);
  assert.equal(
    result.metadata.company.candidates.some((c) => c.value === "hiring"),
    true
  );
});
