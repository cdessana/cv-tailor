import assert from "node:assert/strict";
import test from "node:test";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";

function checkRanges(result) {
  let previousEnd = 0;
  for (const section of result.sections) {
    for (const entry of [section.heading, ...section.units].filter(Boolean)) {
      assert.ok(entry.start >= previousEnd);
      assert.ok(entry.end >= entry.start);
      assert.equal(
        result.originalText.slice(entry.start, entry.end),
        entry.originalText
      );
      previousEnd = entry.end;
    }
  }
}

for (const ending of ["\n", "\r\n", "\r"]) {
  test(`normalizes ${JSON.stringify(ending)} while retaining exact source`, () => {
    const input = [
      "Requirements",
      "• Node.js",
      "  and JavaScript",
      "",
      "Bonus:",
      "1) AWS or GCP",
    ].join(ending);
    const result = preprocess(input);
    assert.equal(result.originalText, input);
    assert.equal(
      result.normalizedText,
      "Requirements\n- Node.js\nand JavaScript\n\nBonus:\n- AWS or GCP"
    );
    assert.deepEqual(
      result.sections.map(({ signal }) => signal),
      ["required", "preferred"]
    );
    assert.deepEqual(
      result.sections.map(({ units }) =>
        units.map(({ type, text }) => ({ type, text }))
      ),
      [
        [{ type: "bullet", text: "Node.js and JavaScript" }],
        [{ type: "bullet", text: "AWS or GCP" }],
      ]
    );
    checkRanges(result);
  });
}

test("splits only a long paragraph at sentence boundaries outside parentheses", () => {
  const first = "A".repeat(330);
  const protectedSentence = `Requirement (${"B".repeat(340)}. still in parentheses) is preserved.`;
  const final = "C".repeat(330);
  const source = `${first}. ${protectedSentence} ${final}.`;
  const result = preprocess(source);
  const units = result.sections[0].units;
  assert.equal(units.length, 3);
  assert.equal(units[0].originalText, `${first}.`);
  assert.equal(units[1].originalText, protectedSentence);
  assert.equal(units[2].originalText, `${final}.`);
  for (const unit of units)
    assert.equal(source.slice(unit.start, unit.end), unit.originalText);
});

test("normalizes mixed endings and horizontal whitespace without losing paragraphs", () => {
  const input =
    "\r\n  Overview\t text  \rwrapped\u00a0\u00a0line\n \t\r\n\rNext paragraph\t \n\n";
  const result = preprocess(input);
  assert.equal(
    result.normalizedText,
    "Overview text\nwrapped line\n\nNext paragraph"
  );
  assert.deepEqual(
    result.sections[0].units.map(({ text }) => text),
    ["Overview text wrapped line", "Next paragraph"]
  );
  assert.equal(result.sections[0].units[0].indentation, "  ");
  checkRanges(result);
});

for (const marker of ["-", "*", "+", "•", "◦", "▪", "1.", "12)"]) {
  test(`normalizes bullet ${marker}`, () => {
    const result = preprocess(`${marker}\tNode.js\n${marker} AWS or GCP`);
    assert.equal(result.normalizedText, "- Node.js\n- AWS or GCP");
    assert.deepEqual(
      result.sections[0].units.map(({ type, text }) => ({ type, text })),
      [
        { type: "bullet", text: "Node.js" },
        { type: "bullet", text: "AWS or GCP" },
      ]
    );
    checkRanges(result);
  });
}

test("splits a compact heading and bullet without changing evidence offsets", () => {
  const source = "Obrigatório \t •   Graduação em Computação";
  const result = preprocess(source);
  assert.equal(result.sections[0].heading.originalText, "Obrigatório");
  assert.equal(
    result.sections[0].units[0].originalText,
    "•   Graduação em Computação"
  );
  assert.equal(result.sections[0].units[0].text, "Graduação em Computação");
  checkRanges(result);
});

const groups = {
  required: [
    "Requirements",
    "Required Qualifications",
    "Must Have",
    "What You'll Need",
  ],
  preferred: ["Preferred Qualifications", "Nice to Have", "Bonus", "Desirable"],
  responsibilities: ["Responsibilities", "What You'll Do", "Your Role", "In this role, you will"],
};
for (const [signal, headings] of Object.entries(groups)) {
  for (const heading of headings) {
    test(`detects heading variants for ${heading}`, () => {
      for (const variant of [
        heading,
        heading.toUpperCase(),
        `${heading}:`,
        `### ${heading} ###`,
        heading.replaceAll("'", "’"),
        heading.replaceAll(" ", "\t  "),
      ]) {
        const result = preprocess(`${variant}\n- Source statement`);
        assert.equal(result.sections.length, 1);
        assert.equal(result.sections[0].signal, signal);
        assert.equal(result.sections[0].heading.originalText, variant);
        assert.equal(result.sections[0].units[0].text, "Source statement");
        checkRanges(result);
      }
    });
  }
}

for (const heading of [
  "Why join Clara",
  "Sobre a Accenture",
  "About Azion",
  "About The Job",
  "About Zerohash",
  "Benefits",
  "The zerohash Culture",
  "Follow us",
  "See something suspicious",
  "Offer Description",
  "About The Position",
  "What we believe in",
  "What we offer",
  "Clara's Hybrid Policy",
  "Sobre o Bradesco",
  "Sobre a área",
  "Modelo de trabalho",
  "O que você encontra aqui",
  "Cuidar de você",
  "Crescer com você",
  "Segurança para o seu futuro",
  "Apoio à sua vida e à sua família",
  "Diversidade",
  "Benefícios",
]) {
  test(`detects company context heading ${heading}`, () => {
    const result = preprocess(`${heading}\nCompany context`);
    assert.equal(result.sections[0].role, "context");
    assert.equal(result.sections[0].signal, null);
  });
}

test("recognizes conservative unmarked scraped section labels", () => {
  const result = preprocess("Qualifications\n- Java\n\nBenefits and Perks\n- Health plan");
  assert.deepEqual(result.sections.map(({ signal, role }) => ({ signal, role })), [
    { signal: "required", role: "candidate-content" },
    { signal: null, role: "context" },
  ]);
});

const portugueseGroups = {
  required: [
    "Requisitos",
    "Requisitos obrigatórios",
    "Qualificações obrigatórias",
    "O que esperamos de você",
    "Conhecimentos necessários",
    "O que procuramos",
  ],
  preferred: [
    "Será um diferencial",
    "Será um diferencial se você tiver",
    "Diferenciais",
    "Desejável",
    "Conhecimentos desejáveis",
    "Requisitos desejáveis",
  ],
  responsibilities: [
    "Responsabilidades",
    "Atividades",
    "Principais atividades",
    "Como será seu dia a dia",
    "O que você fará",
  ],
  competencies: [
    "Perfil que buscamos",
    "Competências",
    "Habilidades comportamentais",
  ],
};
for (const [signal, headings] of Object.entries(portugueseGroups)) {
  for (const heading of headings) {
    test(`detects Portuguese heading ${heading}`, () => {
      for (const suffix of ["", ":", "?", "!", " -"]) {
        const result = preprocess(
          `${heading.toUpperCase()}${suffix}\n- Source statement`
        );
        assert.equal(result.sections[0].signal, signal);
        assert.equal(result.sections[0].heading.text, heading.toUpperCase());
        assert.equal(result.sections[0].units[0].text, "Source statement");
        checkRanges(result);
      }
    });
  }
}

test("Portuguese headings preserve accents and tolerate dash punctuation", () => {
  const input =
    "Requisitos obrigatórios -\n- Java\nSerá um diferencial:\n- Azure";
  const result = preprocess(input);
  assert.deepEqual(
    result.sections.map(({ signal }) => signal),
    ["required", "preferred"]
  );
  assert.equal(result.sections[0].heading.text, "Requisitos obrigatórios");
  assert.equal(result.sections[1].heading.text, "Será um diferencial");
  checkRanges(result);
});

test("recognizes exact unmarked headings and ends candidate sections at context", () => {
  const input = [
    "JOB DESCRIPTION:",
    "What You’ll Own",
    "• Build reliable services.",
    "What You'll Bring",
    "• Experience with distributed systems.",
    "It's a bonus if you have",
    "• Payments experience.",
    "About The Team",
    "We build global products.",
  ].join("\n");
  const result = preprocess(input);

  assert.deepEqual(
    result.sections.map(({ heading, signal, role }) => ({
      heading: heading?.text,
      signal,
      role,
    })),
    [
      { heading: "JOB DESCRIPTION", signal: null, role: "unknown" },
      {
        heading: "What You’ll Own",
        signal: "responsibilities",
        role: "candidate-content",
      },
      {
        heading: "What You'll Bring",
        signal: "required",
        role: "candidate-content",
      },
      {
        heading: "It's a bonus if you have",
        signal: "preferred",
        role: "candidate-content",
      },
      { heading: "About The Team", signal: null, role: "context" },
    ]
  );
  assert.equal(
    result.sections.at(-1).units[0].text,
    "We build global products."
  );
  checkRanges(result);
});

test("does not interpret an unknown short unmarked line as a heading", () => {
  const result = preprocess("Requirements\nA curious engineer\n- Node.js");
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].units[0].text, "A curious engineer");
  assert.equal(result.sections[0].signal, "required");
});

test("unknown headings end prior signals and retain original heading text", () => {
  const result = preprocess(
    "Requirements\n- Node.js\n## Our benefits\n- Holidays\nAbout us:\nWe build tools\nBonus\n- GCP"
  );
  assert.deepEqual(
    result.sections.map(({ signal }) => signal),
    ["required", null, null, "preferred"]
  );
  assert.deepEqual(
    result.sections.map(({ heading }) => heading.text),
    ["Requirements", "Our benefits", "About us", "Bonus"]
  );
  assert.equal(result.sections[1].heading.originalText, "## Our benefits");
  assert.equal(result.sections[2].units[0].type, "paragraph");
  checkRanges(result);
});

test("does not match heading substrings, ordinary capitalized lines, or bullet text", () => {
  const result = preprocess(
    "Our requirements include Node.js.\nA Bonus Is Available\nRequired Qualifications include experience\n- Requirements\n- C++ and C#\nNode.js supports APIs."
  );
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].heading, null);
  assert.equal(result.sections[0].signal, null);
  assert.equal(result.sections[0].units.length, 3);
  assert.equal(result.sections[0].units[1].text, "Requirements");
  assert.equal(
    result.sections[0].units[2].text,
    "C++ and C# Node.js supports APIs."
  );
});

test("preserves punctuation and does not interpret punctuation without bullet spacing", () => {
  const result = preprocess(
    "Node.js, C++, C#, .NET; AWS or GCP.\n1.5 years; -5 degrees; a-b\n*literal\n+plus\nhttps://example.com/job"
  );
  assert.equal(result.sections[0].units.length, 1);
  assert.equal(result.sections[0].units[0].type, "paragraph");
  assert.equal(result.normalizedText, result.originalText);
});

test("keeps nested bullets separate and joins wrapped lines", () => {
  const result = preprocess(
    "Requirements\n- Backend experience\n  with Node.js. Build APIs.\n\t• AWS or GCP\n\t  and deployment experience\n- Communication\n\nUnbulleted paragraph\ncontinued here"
  );
  assert.deepEqual(
    result.sections[0].units.map(({ type, text, indentation }) => ({
      type,
      text,
      indentation,
    })),
    [
      {
        type: "bullet",
        text: "Backend experience with Node.js. Build APIs.",
        indentation: "",
      },
      {
        type: "bullet",
        text: "AWS or GCP and deployment experience",
        indentation: "\t",
      },
      { type: "bullet", text: "Communication", indentation: "" },
      {
        type: "paragraph",
        text: "Unbulleted paragraph continued here",
        indentation: "",
      },
    ]
  );
  checkRanges(result);
});

test("retains unheaded introduction, repeated headings, and heading-only sections", () => {
  const result = preprocess(
    "Join our team\n\nRequirements\n- Node.js\nRequirements\nResponsibilities\n"
  );
  assert.deepEqual(
    result.sections.map(({ heading, signal, units }) => [
      heading?.text ?? null,
      signal,
      units.length,
    ]),
    [
      [null, null, 1],
      ["Requirements", "required", 1],
      ["Requirements", "required", 0],
      ["Responsibilities", "responsibilities", 0],
    ]
  );
  checkRanges(result);
});

test("source offsets index original UTF-16 text including CRLF and emoji", () => {
  const input =
    "🚀 Café\r\n\r\nRequirements:\r\n  • Node.js ou Java — São Paulo\r\n    experiência\r\n";
  const result = preprocess(input);
  const unit = result.sections[1].units[0];
  assert.equal(unit.start, input.indexOf("  •"));
  assert.equal(unit.end, input.lastIndexOf("\r\n"));
  assert.equal(
    unit.originalText,
    "  • Node.js ou Java — São Paulo\r\n    experiência"
  );
  assert.equal(unit.text, "Node.js ou Java — São Paulo experiência");
  assert.equal(result.sections[0].units[0].end, "🚀 Café".length);
  checkRanges(result);
});

for (const input of ["", " \t\r\n\n\r "]) {
  test(`empty document ${JSON.stringify(input)}`, () => {
    assert.deepEqual(preprocess(input), {
      originalText: input,
      normalizedText: "",
      sections: [],
    });
  });
}
for (const input of [null, undefined, 1, {}, [], true]) {
  test(`rejects non-string ${JSON.stringify(input)}`, () => {
    assert.throws(() => preprocess(input), {
      name: "TypeError",
      message: "Job description must be a string.",
    });
  });
}

test("deterministic independent results without state shared between calls", () => {
  const input = "# Requirements\r\n• AWS or GCP\n\n## Benefits\nPaid leave";
  const first = preprocess(input);
  const second = preprocess(input);
  assert.deepEqual(first, second);
  first.sections[0].units[0].text = "modified";
  assert.deepEqual(preprocess(input), second);
});

test("heading signals do not classify individual statements", () => {
  const result = preprocess(
    "Requirements\n- Kubernetes is nice to have\nResponsibilities\n- You will mentor engineers"
  );
  assert.equal(result.sections[0].signal, "required");
  assert.equal(result.sections[1].signal, "responsibilities");
  for (const { units } of result.sections) {
    assert.ok(
      units.every((unit) => !("classification" in unit) && !("kind" in unit))
    );
  }
});

test("preserves empty marked bullets and bare markers without inventing content", () => {
  const result = preprocess("- \n\n-\n\n###\n\n:");
  assert.deepEqual(
    result.sections[0].units.map(({ type, text }) => ({ type, text })),
    [
      { type: "bullet", text: "" },
      { type: "paragraph", text: "-" },
      { type: "paragraph", text: "###" },
      { type: "paragraph", text: ":" },
    ]
  );
  checkRanges(result);
});

test("long or punctuated colon-terminated prose stays content", () => {
  const result = preprocess(
    "Requirements\nWe expect you to be able to do the following:\nExperience with Node.js:\n- Build APIs"
  );
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].units[0].type, "paragraph");
  assert.equal(result.sections[0].units[1].text, "Build APIs");
});

test("recognizes a known heading with presentation full-stop punctuation", () => {
  const result = preprocess("Activities.\nProvide technical support");
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].heading.text, "Activities.");
  assert.equal(result.sections[0].signal, "responsibilities");
  assert.equal(result.sections[0].units[0].text, "Provide technical support");
});

test("recognizes an unmarked company about heading as context", () => {
  const result = preprocess("About EXAMPLE DATA\nEmployer description");
  assert.equal(result.sections[0].role, "context");
  assert.equal(result.sections[0].signal, null);
});
