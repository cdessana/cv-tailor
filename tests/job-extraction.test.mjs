import assert from "node:assert/strict";
import test from "node:test";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { extract } from "../lib/job-parser/extract.mjs";
import { normalizeExtraction } from "../lib/job-parser/normalize.mjs";

for (const [text, value, classification] of [
  ["Experience with Node.js is required", "Node.js", "required"],
  ["Node.js is required.", "Node.js", "required"],
  ["Node.js is required!!", "Node.js", "required"],
  ["Required: nodejs!", "nodejs", "required"],
  ["Nice to have: Kubernetes", "Kubernetes", "preferred"],
  ["Preferred: postgres", "postgres", "preferred"],
  ["EXPERIENCE WITH NodeJS IS PREFERRED.", "NodeJS", "preferred"],
  ["Requirements\n- Experience with Mongo DB", "Mongo DB", "required"],
  ["Bonus\n- Kubernetes", "Kubernetes", "preferred"],
  ["Requirements\n- Nice to have: k8s", "k8s", "preferred"],
]) {
  test(`extract ${text}`, () => {
    const result = extract(preprocess(text));
    assert.equal(result.unresolved.length, 0);
    assert.equal(result.extraction.items.length, 1);
    assert.equal(result.extraction.items[0].value, value);
    assert.equal(result.extraction.items[0].classification, classification);
    assert.equal(result.extraction.items[0].kind, "skill");
  });
}
for (const text of [
  "Node.js is not required",
  "No experience with Node.js is required",
  "Required: Node.js but optional",
  "Nice to have: Node.js is required",
  "Experience with Node.js is required if available",
  "Node.js is required. Java is preferred.",
  "Nice to have: AWS and GCP",
  "Required: AWS or (GCP and Azure)",
  "Required: AWS, GCP",
  "Required: AWS or GCP, Azure or Java",
  "Required: AWS or",
  "Required: AWS or AWS",
  "Required: Node.js; build APIs",
  "Required: Node.js is preferred",
  "Required: AWS or GCP, Azure",
]) {
  test(`unresolved ${text}`, () => {
    const doc = preprocess(text);
    const result = extract(doc);
    assert.deepEqual(result.extraction.items, []);
    assert.equal(result.unresolved.length, 1);
    assert.deepEqual(result.unresolved[0].unit, doc.sections[0].units[0]);
  });
}
test("preserves the explicit high-confidence responsibilities section signal", () => {
  const result = extract(preprocess("In this role, you will\n- Node.js is required"));
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(result.extraction.items.map(({ kind, classification, value }) => ({ kind, classification, value })), [
    { kind: "responsibility", classification: "not-applicable", value: "Node.js is required" },
  ]);
});
for (const [text, values] of [
  ["Experience with AWS or GCP is required", ["AWS", "GCP"]],
  ["Nice to have: AWS, GCP, or Azure", ["AWS", "GCP", "Azure"]],
  ["Required: Java or Kotlin", ["Java", "Kotlin"]],
  ["Preferred: nodejs or k8s", ["nodejs", "k8s"]],
]) {
  test(`alternative ${text}`, () => {
    const { extraction } = extract(preprocess(text));
    assert.equal(extraction.items.length, 1);
    assert.equal(extraction.items[0].type, "alternative");
    assert.equal(extraction.items[0].operator, "anyOf");
    assert.deepEqual(extraction.items[0].values, values);
  });
}
const single = (value) => ({
  items: [
    {
      type: "item",
      kind: "requirement",
      classification: "required",
      value,
      evidence: { quote: "Original source" },
    },
  ],
});
for (const [value, expected] of [
  ["nodejs", "Node.js"],
  ["node.js", "Node.js"],
  ["k8s", "Kubernetes"],
  ["postgres", "PostgreSQL"],
  ["  MONGO  DB ", "MongoDB"],
  ["cloud", "cloud"],
  ["JVM", "JVM"],
  ["CI/CD", "CI/CD"],
  ["GitHub Actions", "GitHub Actions"],
  ["gRPC", "gRPC"],
  ["  UnknownTech  ", "  UnknownTech  "],
  ["Experience with NodeJS", "Experience with NodeJS"],
]) {
  test(`normalize complete value ${value}`, () => {
    const input = single(value);
    const before = structuredClone(input);
    const result = normalizeExtraction(input);
    assert.equal(result.items[0].value, expected);
    assert.deepEqual(input, before);
    assert.deepEqual(result.items[0].evidence, input.items[0].evidence);
  });
}
test("integration preserves original extraction, metadata and evidence", () => {
  const doc = preprocess(
    "Requirements\r\n• Experience with nodejs\r\n  is required\r\n\r\nBonus:\r\n- Preferred: k8s or postgres"
  );
  const originalDoc = structuredClone(doc);
  const result = extract(doc);
  const before = structuredClone(result);
  const normalized = normalizeExtraction(result.extraction);
  assert.equal(result.extraction.items[0].value, "nodejs");
  assert.equal(normalized.items[0].value, "Node.js");
  assert.deepEqual(normalized.items[1].values, ["Kubernetes", "PostgreSQL"]);
  assert.equal(
    normalized.items[0].evidence.quote,
    "• Experience with nodejs\r\n  is required"
  );
  assert.equal(normalized.items[0].sourceSection, "Requirements");
  assert.deepEqual(doc, originalDoc);
  assert.deepEqual(result, before);
  const input = {
    ...single("nodejs"),
    metadata: { company: { value: "nodejs", evidence: { quote: "nodejs" } } },
  };
  assert.deepEqual(normalizeExtraction(input).metadata, input.metadata);
});
test("unknown explicit qualifications keep generic kind", () => {
  for (const value of [
    "UnknownTech",
    ".NET",
    "Five years of experience",
    "Communication",
  ]) {
    const result = extract(preprocess(`Required: ${value}`));
    assert.equal(result.extraction.items[0].kind, "requirement");
    assert.equal(result.extraction.items[0].value, value);
  }
});
test("empty input and unsupported source remain separate", () => {
  assert.deepEqual(extract(preprocess("")), {
    extraction: { items: [] },
    unresolved: [],
  });
  const doc = preprocess("Join us\n\nRequired: nodejs\n\nOther details");
  const result = extract(doc);
  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.unresolved.length, 2);
});

test("extracts explicit company and title metadata without semantic inference", () => {
  const result = extract(
    preprocess(
      "Example is hiring a Senior Engineer\nRequirements\n- Node.js is required"
    )
  );
  assert.deepEqual(result.extraction.metadata, {
    company: {
      value: "Example",
      evidence: { quote: "Example is hiring a Senior Engineer" },
      sourceUnitIds: [result.extraction.metadata.company.sourceUnitIds[0]],
    },
    title: {
      value: "Senior Engineer",
      evidence: { quote: "Example is hiring a Senior Engineer" },
      sourceUnitIds: [result.extraction.metadata.title.sourceUnitIds[0]],
    },
  });
  assert.equal(result.unresolved.length, 0);
});

test("extracts standalone company headers and Join-as titles across sections", () => {
  const result = extract(preprocess([
    "Company: SnowHeap",
    "Tasks",
    "- Build reliable software.",
    "Requirements",
    "- Strong proficiency in Elixir.",
    "",
    "Join SnowHeap LLC as a Senior Fullstack Software Engineer and help shape the future.",
  ].join("\n")));
  assert.equal(result.extraction.metadata.company.value, "SnowHeap");
  assert.equal(result.extraction.metadata.title.value, "Senior Fullstack Software Engineer");
  assert.equal(result.extraction.items[0].kind, "responsibility");
  assert.equal(result.extraction.items[1].kind, "requirement");
  assert.ok(result.extraction.metadata.company.sourceUnitIds?.length);
  assert.ok(result.extraction.metadata.title.sourceUnitIds?.length);
});

test("extracts LinkedIn archive header metadata deterministically", () => {
  const source = [
    "JOB POSTING ARCHIVE: SOFTWARE ENGINEER",
    "Company:              Example Corp",
    "Job Title:            Software Engineer",
    "Location:             Manaus, Amazonas, Brazil",
    "Workplace Type:       Hybrid",
    "Employment Type:      Full-time",
    "LinkedIn URL:         https://www.linkedin.com/jobs/view/123",
  ].join("\n");
  const result = extract(preprocess(source));
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(result.extraction.metadata).map(([key, record]) => [
        key,
        record.value,
      ])
    ),
    {
      company: "Example Corp",
      title: "Software Engineer",
      location: "Manaus, Amazonas, Brazil",
      workArrangement: "Hybrid",
      employmentType: "Full-time",
      sourceUrl: "https://www.linkedin.com/jobs/view/123",
    }
  );
  assert.equal(
    result.extraction.metadata.company.evidence.quote,
    "Company:              Example Corp"
  );
  assert.equal(result.unresolved.length, 0);
});

test("preserves archive skill keywords without promoting them to requirements", () => {
  const result = extract(
    preprocess(["SKILLS & KEYWORDS:", "• Java", "• AWS"].join("\n"))
  );
  assert.deepEqual(
    result.extraction.items.map(({ value, kind, classification }) => ({
      value,
      kind,
      classification,
    })),
    [
      { value: "Java", kind: "skill", classification: "ambiguous" },
      { value: "AWS", kind: "skill", classification: "ambiguous" },
    ]
  );
  assert.equal(result.unresolved.length, 0);
});

test("does not treat prose under a skills heading as a keyword", () => {
  const result = extract(
    preprocess(
      "SKILLS & KEYWORDS:\n• Experience building APIs with Java and AWS."
    )
  );
  assert.equal(result.extraction.items.length, 0);
  assert.equal(result.unresolved.length, 1);
});

test("extracts complete bullets from recognized candidate sections without a provider", () => {
  const result = extract(
    preprocess(
      [
        "In this role, you will",
        "- Own the integration lifecycle for customers.",
        "",
        "Must haves",
        "- Strong proficiency in one or more backend languages (preferably Java).",
        "- Java or Kotlin",
        "",
        "Nice to haves",
        "- Exposure to connector frameworks (e.g. N8N or Zapier).",
      ].join("\n")
    )
  );
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(
    result.extraction.items.map(({ type, kind, classification, value, values }) => ({
      type,
      kind,
      classification,
      value,
      values,
    })),
    [
      {
        type: "item",
        kind: "responsibility",
        classification: "not-applicable",
        value: "Own the integration lifecycle for customers.",
        values: undefined,
      },
      {
        type: "item",
        kind: "requirement",
        classification: "required",
        value: "Strong proficiency in one or more backend languages (preferably Java).",
        values: undefined,
      },
      {
        type: "item",
        kind: "requirement",
        classification: "required",
        value: "Java or Kotlin",
        values: undefined,
      },
      {
        type: "item",
        kind: "requirement",
        classification: "preferred",
        value: "Exposure to connector frameworks (e.g. N8N or Zapier).",
        values: undefined,
      },
    ]
  );
});

test("keeps archive separators out of units and does not join surrounding prose", () => {
  const document = preprocess([
    "Requirements",
    "- Java",
    "--------------------------------------------------------------------------------",
    "- Spring Boot",
  ].join("\n"));
  assert.equal(document.normalizedText.includes("---"), false);
  assert.deepEqual(document.sections[0].units.map((unit) => unit.text), ["Java", "Spring Boot"]);
  assert.deepEqual(extract(document).extraction.items.map((item) => item.value), ["Java", "Spring Boot"]);
});

test("does not force contextual paragraphs under responsibility headings into items", () => {
  const result = extract(preprocess([
    "What You'll Do",
    "This is a Sao Paulo-based team working with teams in the US and Europe.",
    "Responsibilities",
    "- Design integration experiences.",
  ].join("\n")));
  assert.deepEqual(result.extraction.items.map((item) => item.value), ["Design integration experiences."]);
  assert.equal(result.unresolved[0].unit.text, "This is a Sao Paulo-based team working with teams in the US and Europe.");
});

test("recognizes platform-added requirements as source-grounded required bullets", () => {
  const result = extract(preprocess("Requirements added by the job poster\n• 6+ years of work experience with Java"));
  assert.deepEqual(result.extraction.items.map(({ value, kind, classification, provenance }) => ({ value, kind, classification, provenance })), [
    { value: "6+ years of work experience with Java", kind: "requirement", classification: "required", provenance: "job-poster-added" },
  ]);
});

test("explicit candidate-section bullets never require action or technology heuristics", () => {
  const result = extract(preprocess([
    "Requirements",
    "- You will mentor engineers",
    "Responsibilities",
    "- Good knowledge of Unix, SQL and scripting languages",
  ].join("\n")));
  assert.deepEqual(result.extraction.items.map(({ value, kind, classification }) => ({ value, kind, classification })), [
    { value: "You will mentor engineers", kind: "requirement", classification: "required" },
    { value: "Good knowledge of Unix, SQL and scripting languages", kind: "responsibility", classification: "not-applicable" },
  ]);
  assert.equal(result.unresolved.length, 0);
});

test("nested technology details do not become independent requirements", () => {
  const result = extract(preprocess([
    "Required Qualifications",
    "- Strong experience with AWS, including:",
    "  - Amazon SQS, Amazon SNS, AWS Lambda",
  ].join("\n")));
  assert.deepEqual(result.extraction.items.map((item) => item.value), [
    "Strong experience with AWS",
  ]);
  assert.deepEqual(result.extraction.items[0].examples, [
    { value: "Amazon SQS, Amazon SNS, AWS Lambda" },
  ]);
  assert.equal(result.extraction.coverage[0].status, "excluded");
  assert.match(result.extraction.coverage[0].reason, /not an independent requirement/u);
});

test("nested technology details remain attached as examples", () => {
  const result = extract(
    preprocess(
      [
        "Requirements",
        "- Strong experience with AWS, including:",
        "  - Amazon SQS",
        "  - Amazon SNS",
        "  - AWS Lambda",
      ].join("\n")
    )
  );
  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.items[0].value, "Strong experience with AWS");
  assert.deepEqual(
    result.extraction.items[0].examples.map(({ value }) => value),
    ["Amazon SQS", "Amazon SNS", "AWS Lambda"]
  );
  assert.deepEqual(result.extraction.items[0].sourceUnitIds.length, 1);
  assert.ok(result.extraction.coverage.every(({ reason }) => /preserved as an example/u.test(reason)));
});

test("extracts Worldpay-style ownership, qualification, and bonus bullets", () => {
  const document = preprocess(
    [
      "What You’ll Own",
      "- Develop and maintain application code.",
      "",
      "What You’ll Bring",
      "- Previous experience as a Software Developer.",
      "- Experience with Java, C/C++, and/or Free Pascal.",
      "",
      "It’s a bonus if you have",
      "- A proactive mindset.",
    ].join("\n")
  );
  const result = extract(document);
  assert.deepEqual(
    result.extraction.items.map(({ kind, classification, value }) => ({ kind, classification, value })),
    [
      { kind: "responsibility", classification: "not-applicable", value: "Develop and maintain application code." },
      { kind: "requirement", classification: "required", value: "Previous experience as a Software Developer." },
      { kind: "requirement", classification: "required", value: "Experience with Java, C/C++, and/or Free Pascal." },
      { kind: "requirement", classification: "preferred", value: "A proactive mindset." },
    ]
  );
  assert.equal(result.unresolved.length, 0);
});

test("extracts BairesDev Portuguese candidate sections", () => {
  const result = extract(
    preprocess(
      [
        "O Que Você Fará",
        "- Projetar aplicações .NET.",
        "",
        "O Que Procuramos",
        "- 3+ anos de experiência em desenvolvimento .NET.",
        "- Experiência com ASP.NET ou .NET Core.",
      ].join("\n")
    )
  );
  assert.deepEqual(result.extraction.items.map(({ kind, classification, value }) => ({ kind, classification, value })), [
    { kind: "responsibility", classification: "not-applicable", value: "Projetar aplicações .NET." },
    { kind: "requirement", classification: "required", value: "3+ anos de experiência em desenvolvimento .NET." },
    { kind: "requirement", classification: "required", value: "Experiência com ASP.NET ou .NET Core." },
  ]);
  assert.equal(result.extraction.items[2].type, "item");
  assert.equal(result.unresolved.length, 0);
});

test("extracts bullets from structured qualification headings while retaining complex choices", () => {
  const document = preprocess(
    [
      "Key Responsibilities",
      "- Develop and maintain systems.",
      "",
      "Required Qualifications",
      "- Understanding of networking concepts.",
      "- Strong experience using Rust or C/C++.",
      "",
      "Preferred Qualifications",
      "- Familiarity with Docker and Kubernetes.",
    ].join("\n")
  );
  const result = extract(document);
  assert.deepEqual(
    result.extraction.items.map(({ kind, classification, value }) => ({
      kind,
      classification,
      value,
    })),
    [
      {
        kind: "responsibility",
        classification: "not-applicable",
        value: "Develop and maintain systems.",
      },
      {
        kind: "requirement",
        classification: "required",
        value: "Understanding of networking concepts.",
      },
      {
        kind: "requirement",
        classification: "required",
        value: "Strong experience using Rust or C/C++.",
      },
      {
        kind: "requirement",
        classification: "preferred",
        value: "Familiarity with Docker and Kubernetes.",
      },
    ]
  );
  assert.equal(result.unresolved.length, 0);
});

test("extracts nested job sections and excludes employer policy copy", () => {
  const result = extract(
    preprocess(
      [
        "Requirements Description",
        "- Bachelor's degree in computer science.",
        "",
        "Your Responsibilities",
        "- Write automated tests.",
        "",
        "Desired",
        "- Python",
        "",
        "Soft Skills",
        "- Solution oriented",
        "",
        "Foreign language",
        "- English fluent",
        "",
        "Example is a leading global provider of research services.",
        "Example maintains a zero tolerance policy for candidate fraud.",
      ].join("\n")
    )
  );
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(
    result.extraction.items.map(({ kind, classification, value }) => ({ kind, classification, value })),
    [
      { kind: "requirement", classification: "required", value: "Bachelor's degree in computer science." },
      { kind: "responsibility", classification: "not-applicable", value: "Write automated tests." },
      { kind: "requirement", classification: "preferred", value: "Python" },
      { kind: "competency", classification: "ambiguous", value: "Solution oriented" },
      { kind: "requirement", classification: "required", value: "English fluent" },
    ]
  );
  assert.equal(result.extraction.coverage.filter(({ status }) => status === "excluded").length, 1);
});

test("excludes recognized context and non-qualification leads before provider fallback", () => {
  const result = extract(
    preprocess(
      [
        "Must haves",
        "We're looking for someone who meets the minimum requirements to be considered for the role.",
        "- Experience with Java.",
        "",
        "Nice to haves",
        "Clara is committed to hybrid work, combining remote flexibility with office collaboration.",
        "",
        "What we offer",
        "- Flexible schedule.",
      ].join("\n")
    )
  );
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.items[0].value, "Java");
  assert.equal(result.extraction.coverage.length, 3);
});

test("preserves complex choices under high-confidence headings losslessly", () => {
  const document = preprocess(
    "Must haves\n- Working proficiency in English and Spanish, or English and Portuguese"
  );
  const result = extract(document);
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.extraction.items[0].value, "Working proficiency in English and Spanish, or English and Portuguese");
});

test("extracts structured Portuguese sections and separates benefits from requirements", () => {
  const result = extract(
    preprocess(
      [
        "JOB POSTING ARCHIVE: ENGINEER",
        "Company: Banco Example",
        "Job Title: Pessoa Desenvolvedora",
        "Workplace Type: On-site",
        "",
        "Como será seu dia a dia",
        "- Implementar sistemas.",
        "",
        "Modelo de trabalho",
        "Híbrido - 2x Presencial",
        "",
        "Requisitos",
        "- Experiência com microsserviços.",
        "- Linguagem de programação: Java.",
        "",
        "O que você encontra aqui",
        "Cuidar de você",
        "- Plano de saúde e odontológico",
      ].join("\n")
    )
  );
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(
    result.extraction.items.map(({ value, kind, classification }) => ({
      value,
      kind,
      classification,
    })),
    [
      {
        value: "Implementar sistemas.",
        kind: "responsibility",
        classification: "not-applicable",
      },
      {
        value: "Experiência com microsserviços.",
        kind: "requirement",
        classification: "required",
      },
      {
        value: "Linguagem de programação: Java.",
        kind: "requirement",
        classification: "required",
      },
    ]
  );
  assert.equal(result.extraction.metadata.workArrangement.value, "On-site");
  assert.deepEqual(result.extraction.metadata.workArrangement.candidates, [
    {
      value: "On-site",
      evidence: { quote: "Workplace Type: On-site" },
      sourceUnitIds: [result.extraction.metadata.workArrangement.candidates[0].sourceUnitIds[0]],
    },
    {
      value: "Híbrido - 2x Presencial",
      evidence: { quote: "Híbrido - 2x Presencial" },
      sourceSection: "Modelo de trabalho",
      sourceUnitIds: [result.extraction.metadata.workArrangement.candidates[1].sourceUnitIds[0]],
    },
  ]);
  assert.equal(result.extraction.coverage.filter(({ status }) => status === "excluded").length, 1);
});

test("excludes a Portuguese responsibilities lead without suppressing its bullets", () => {
  const result = extract(
    preprocess(
      [
        "Como será seu dia a dia",
        "Como Software Engineer III, você atuará na área de Cartões e suas principais atividades serão:",
        "- Implementar sistemas.",
      ].join("\n")
    )
  );
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.items[0].kind, "responsibility");
  assert.equal(result.extraction.coverage[0].status, "excluded");
});

test("excludes LinkedIn archive boilerplate deterministically", () => {
  const source = [
    "JOB POSTING ARCHIVE: ENGINEER",
    "Company: Example",
    "Job Title: Engineer",
    "",
    "JOB DESCRIPTION:",
    "--------------------------------------------------------------------------------",
    "Detailed job description for Engineer at Example.",
    "",
    "Location: Manaus, Brazil",
    "Date Posted: 2026-01-01",
    "Official Job ID: 123",
    "Direct LinkedIn Link: https://example.com/job",
    "",
    "Key Responsibilities and Requirements can be viewed directly on LinkedIn at https://example.com/job.",
    "",
    "================================================================================",
    "Archived via LinkedIn Job Data Fetcher | Job ID: 123",
    "================================================================================",
  ].join("\n");
  const result = extract(preprocess(source));
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.extraction.coverage.length, 5);
  assert.ok(
    result.extraction.coverage.some((entry) => entry.status === "metadata")
  );
});

test("extracts a company from a Portuguese about heading", () => {
  const result = extract(
    preprocess(
      "Pessoa Dev Full Stack PL\nOSASCO, SP, Brasil\nSobre o Bradesco\nRequisitos\n- Experiência com Java"
    )
  );
  assert.equal(result.extraction.metadata.company.value, "Bradesco");
  assert.equal(
    result.extraction.metadata.company.evidence.quote,
    "Sobre o Bradesco"
  );
});
test("reject malformed documents and altered source ranges", () => {
  for (const value of [null, {}, "text", { originalText: "" }])
    assert.throws(() => extract(value), TypeError);
  const doc = preprocess("Required: nodejs");
  doc.sections[0].units[0].start = 2;
  assert.throws(() => extract(doc), TypeError);
});
test("reject invalid dictionary in both stages", () => {
  const dictionary = { A: ["shared"], B: ["SHARED"] };
  assert.throws(
    () => extract(preprocess("Required: A"), dictionary),
    /Invalid parser aliases/
  );
  assert.throws(
    () => normalizeExtraction(single("A"), dictionary),
    /Invalid parser aliases/
  );
});
test("reject schema-invalid normalization input", () => {
  for (const value of [
    {},
    single(123),
    { ...single("Node.js"), unexpected: true },
  ])
    assert.throws(
      () => normalizeExtraction(value),
      /Invalid intermediate extraction/
    );
});
test("reject alternatives collapsed by normalization without mutation", () => {
  const result = extract(preprocess("Required: nodejs or Node.js"));
  const before = structuredClone(result);
  assert.throws(
    () => normalizeExtraction(result.extraction),
    /collapses alternative/
  );
  assert.deepEqual(result, before);
});

test("leaves unbulleted activity prose available for semantic enrichment", () => {
  const result = extract(
    preprocess(
      "Activities.\nProvide technical support to development teams\n\nGood knowledge of Unix"
    )
  );
  assert.deepEqual(result.extraction.items, []);
  assert.equal(result.unresolved.length, 2);
});

test("extracts a clear competency mixed into activities without guessing tenure", () => {
  const result = extract(
    preprocess(
      [
        "Activities.",
        "Validated collaboration and communication skills, being able to lead in a global environment",
        "",
        "Preferably we are looking for people with five or more years of experience.",
      ].join("\n")
    )
  );
  assert.equal(result.extraction.items.length, 0);
  assert.equal(result.unresolved.length, 2);
});

test("excludes application instructions misplaced below a qualification heading", () => {
  const result = extract(
    preprocess(
      "Basic Qualifications\n- Experience with SQL\n\nIf you are interested, please send your resume.\n\nLic. Salvador Velasco."
    )
  );
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.coverage.filter(({ status }) => status === "excluded").length, 2);
});

test("handles flattened activity requirements and archive recruiting copy", () => {
  const result = extract(
    preprocess(
      [
        "JOB POSTING ARCHIVE: ENGINEER",
        "Req ID: 12345",
        "Example strives to hire exceptional people who want to grow with us.",
        "We are currently seeking an Engineer to join our team.",
        "Location: Manaus",
        "Activities.",
        "Good knowledge of Unix, SQL and scripting languages",
      ].join("\n\n")
    )
  );
  assert.equal(result.extraction.items.length, 0);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.extraction.coverage.filter(({ status }) => status === "excluded").length, 5);
});

test("extracts Accenture-style Portuguese role and candidate sections", () => {
  const result = extract(
    preprocess(
      [
        "O que você vai fazer no seu dia a dia:",
        "- Executar testes unitários e integrados.",
        "",
        "O que estamos procurando na pessoa que vai fazer parte do time:",
        "- Domínio de Cobol, CICS, DB2, VSAM e JCL.",
        "",
        "Além disso, é desejável conhecimento:",
        "- Experiência em ambientes ágeis ou transformação digital",
        "",
        "Benefícios:",
        "- Assistência médica",
      ].join("\n")
    )
  );
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(
    result.extraction.items.map(({ type, kind, classification, value, values }) => ({
      type,
      kind,
      classification,
      value,
      values,
    })),
    [
      {
        type: "item",
        kind: "responsibility",
        classification: "not-applicable",
        value: "Executar testes unitários e integrados.",
        values: undefined,
      },
      {
        type: "item",
        kind: "requirement",
        classification: "required",
        value: "Domínio de Cobol, CICS, DB2, VSAM e JCL.",
        values: undefined,
      },
      {
        type: "item",
        kind: "requirement",
        classification: "preferred",
        value: "Experiência em ambientes ágeis ou transformação digital",
        values: undefined,
      },
    ]
  );
  assert.equal(result.extraction.coverage.filter(({ status }) => status === "excluded").length, 1);
});

test("excludes archive separators joined to employer context", () => {
  const result = extract(
    preprocess(
      "JOB POSTING ARCHIVE: ENGINEER\n\nJOB DESCRIPTION:\n--------------------------------------------------------------------------------\nSobre a Accenture"
    )
  );
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.extraction.items.length, 0);
  assert.equal(result.extraction.coverage.length, 1);
});
