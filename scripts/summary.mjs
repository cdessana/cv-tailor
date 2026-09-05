import fs from "node:fs/promises";
import { z } from "zod";
import { generateText, currentProvider } from "./llm.mjs";

const [
  resumePath,
  planPath,
  outputPath = "output/flash/resume-final.json",
  reportPath = "output/flash/summary-report.json",
] = process.argv.slice(2);

if (!resumePath || !planPath) {
  console.error(
    "Usage: node scripts/summary.mjs <resume-rewritten.json> <tailoring-plan.json> [output.json] [report.json]"
  );
  process.exit(1);
}

const resume = JSON.parse(await fs.readFile(resumePath, "utf8"));

const plan = JSON.parse(await fs.readFile(planPath, "utf8"));

function normalize(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}+#.%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseExists(phrase, text) {
  const needle = normalize(phrase);

  const haystack = normalize(text);

  if (!needle || !haystack) {
    return false;
  }

  return ` ${haystack} `.includes(` ${needle} `);
}

function unique(values) {
  return [...new Set(values)];
}

/*
 * ----------------------------------------
 * Structured output
 * ----------------------------------------
 */

const summarySchema = z.object({
  summary: z.string().min(1),
});

const summaryJsonSchema = z.toJSONSchema(summarySchema);

/*
 * ----------------------------------------
 * Technology detection
 * ----------------------------------------
 */

const technologyPatterns = [
  "Node.js",
  "NodeJS",
  "JavaScript",
  "TypeScript",
  "MongoDB",
  "PostgreSQL",
  "MySQL",
  "SQL Server",
  "Redis",
  "React",
  "React Native",
  "Angular",
  "NestJS",
  "GraphQL",
  "gRPC",
  "RPC",
  "REST",
  "REST APIs",
  "RESTful APIs",
  "Java",
  "Kotlin",
  "C#",
  ".NET",
  ".NET Core",
  "Spring Boot",
  "Python",
  "Flask",
  "WPF",
  "GCP",
  "Google Cloud",
  "Google Cloud Platform",
  "AWS",
  "Azure",
  "GitLab CI",
  "CI/CD",
  "Entity Framework Core",
  "LINQ",
  "Swagger",
  "Serilog",
  "JWT",
];

function detectTechnologies(text) {
  const normalized = normalize(text);

  return unique(
    technologyPatterns.filter((technology) =>
      normalized.includes(normalize(technology))
    )
  );
}

function canonicalTechnology(value) {
  const normalized = normalize(value);

  const groups = [
    ["Node.js", "NodeJS"],
    ["REST", "REST APIs", "RESTful APIs"],
    ["GCP", "Google Cloud", "Google Cloud Platform"],
    [".NET", ".NET Core"],
    ["CI/CD", "GitLab CI"],
    ["RPC", "gRPC"],
  ];

  for (const group of groups) {
    if (group.some((item) => normalize(item) === normalized)) {
      return normalize(group[0]);
    }
  }

  return normalized;
}

/*
 * ----------------------------------------
 * Build professional evidence by role
 * ----------------------------------------
 */

const workEvidence = (resume.work ?? []).map((work) => {
  const bullets = work.highlights ?? [];

  const text = bullets.join(" ");

  return {
    company: work.name,

    position: work.position,

    bullets,

    text,

    technologies: unique(detectTechnologies(text).map(canonicalTechnology)),
  };
});

const professionalText = workEvidence.map((item) => item.text).join(" ");

const professionalTechnologies = unique(
  detectTechnologies(professionalText).map(canonicalTechnology)
);

/*
 * ----------------------------------------
 * Supported target terms
 * ----------------------------------------
 */

const targetCoverage = (plan.globalCoverage ?? [])
  .filter((item) => item.covered)
  .map((item) => ({
    term: item.term,

    category: item.category,

    status: item.status,
  }));

const unsupportedTerms = (plan.safety?.unsupportedTerms ?? []).map(
  (item) => item.term
);

/*
 * ----------------------------------------
 * Existing summary
 * ----------------------------------------
 */

const originalSummary = resume.basics?.summary ?? "";

const originalNumberTokens = new Set(
  originalSummary.match(/\b\d+\+?%?\b/g) ?? []
);

/*
 * ----------------------------------------
 * Helper: sentence splitting
 * ----------------------------------------
 */

function splitSentences(text) {
  return String(text)
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/*
 * ----------------------------------------
 * Unsupported terms
 * ----------------------------------------
 */

function unsupportedTermIssues(text) {
  return unsupportedTerms
    .filter((term) => phraseExists(term, text))
    .map((term) => `Unsupported job term introduced: ${term}`);
}

/*
 * ----------------------------------------
 * Technologies
 * ----------------------------------------
 */

function technologyIssues(text) {
  const detected = detectTechnologies(text);

  return detected
    .filter(
      (technology) =>
        !professionalTechnologies.includes(canonicalTechnology(technology))
    )
    .map(
      (technology) =>
        `Technology not present in final professional bullets: ${technology}`
    );
}

/*
 * ----------------------------------------
 * Numbers
 * ----------------------------------------
 */

function numberIssues(text) {
  const numbers = text.match(/\b\d+\+?%?\b/g) ?? [];

  return unique(
    numbers
      .filter((number) => !originalNumberTokens.has(number))
      .map((number) => `New number introduced in summary: ${number}`)
  );
}

/*
 * ----------------------------------------
 * Length and structure
 * ----------------------------------------
 */

function lengthIssues(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);

  const issues = [];

  if (words.length > 85) {
    issues.push(`Summary too long: ${words.length} words`);
  }

  if (words.length < 30) {
    issues.push(`Summary too short: ${words.length} words`);
  }

  return issues;
}

function sentenceIssues(text) {
  const sentences = splitSentences(text);

  if (sentences.length < 2 || sentences.length > 3) {
    return [`Summary must contain 2 or 3 sentences; found ${sentences.length}`];
  }

  return [];
}

/*
 * ----------------------------------------
 * Forbidden strength claims
 * ----------------------------------------
 */

function forbiddenClaimsIssues(text) {
  const normalized = normalize(text);

  const patterns = [
    {
      term: "expert in",

      reason: 'Avoid unverified "expert" level',
    },

    {
      term: "deep expertise",

      reason: "Avoid unverified expertise-strength claim",
    },

    {
      term: "extensive experience with react",

      reason:
        "React is supported by certification, not professional work evidence",
    },

    {
      term: "ensure code quality",

      reason: "Avoid broad guarantee-style claim about code quality",
    },

    {
      term: "ensuring code quality",

      reason: "Avoid broad guarantee-style claim about code quality",
    },

    {
      term: "enforce ci cd",

      reason:
        "Avoid stronger ownership claim for CI/CD than the evidence supports",
    },

    {
      term: "enforcing ci cd",

      reason:
        "Avoid stronger ownership claim for CI/CD than the evidence supports",
    },

    {
      term: "regular code reviews",

      reason: "Code review frequency is not supported by the evidence",
    },

    {
      term: "maintaining high availability",

      reason:
        "Availability is supported only as an engineering concern, not as a verified achieved level",
    },

    {
      term: "maintained high availability",

      reason:
        "Availability is supported only as an engineering concern, not as a verified achieved level",
    },

    {
      term: "achieving high availability",

      reason:
        "Availability is supported only as an engineering concern, not as a verified outcome",
    },

    {
      term: "delivering high availability",

      reason:
        "Availability is supported only as an engineering concern, not as a verified outcome",
    },

    {
      term: "maintaining high performance",

      reason:
        "Performance must not be generalized into an unverified sustained level",
    },
  ];

  return patterns
    .filter((item) => normalized.includes(normalize(item.term)))
    .map((item) => item.reason);
}

/*
 * ----------------------------------------
 * Generic causal strengthening
 * ----------------------------------------
 */

function causalStrengtheningIssues(text) {
  const normalized = normalize(text);

  const suspiciousClaims = [
    "improve reliability",
    "improves reliability",
    "improved reliability",

    "improve performance",
    "improves performance",
    "improved performance",

    "ensure reliability",
    "ensures reliability",

    "guarantee reliability",
    "guarantees reliability",

    "enhance code quality",
    "enhances code quality",
    "enhanced code quality",

    "improve code quality",
    "improves code quality",
    "improved code quality",

    "enhance system reliability",
    "enhances system reliability",
    "enhanced system reliability",

    "improve system reliability",
    "improves system reliability",
    "improved system reliability",

    "maintain system reliability",
    "maintains system reliability",
    "maintaining system reliability",

    "increase reliability",
    "increases reliability",

    "boost reliability",
    "boosts reliability",
  ];

  return suspiciousClaims
    .filter((claim) => normalized.includes(normalize(claim)))
    .map((claim) => `Potentially unsupported causal claim: ${claim}`);
}

/*
 * ----------------------------------------
 * Causal connectors
 * ----------------------------------------
 *
 * Summary should describe the career, not
 * infer that one activity caused another.
 * ----------------------------------------
 */

function causalConnectorIssues(text) {
  const sentences = splitSentences(text);

  const issues = [];

  const connectors = [
    "resulting in",
    "leading to",
    "which improved",
    "which improves",
    "thereby improving",
    "thereby increasing",
    "which enhanced",
    "which enhances",
  ];

  for (const sentence of sentences) {
    const normalized = normalize(sentence);

    for (const connector of connectors) {
      if (normalized.includes(normalize(connector))) {
        issues.push(`Potential inferred causal relationship: ${connector}`);
      }
    }
  }

  return unique(issues);
}

/*
 * ----------------------------------------
 * Cross-company stack mixing
 * ----------------------------------------
 */

function roleSupportsTechnologies(technologies) {
  const canonical = unique(technologies.map(canonicalTechnology));

  return workEvidence.some((role) =>
    canonical.every((technology) => role.technologies.includes(technology))
  );
}

function crossCompanyMixingIssues(text) {
  const sentences = splitSentences(text);

  const issues = [];

  for (const sentence of sentences) {
    const technologies = detectTechnologies(sentence);

    if (technologies.length < 2) {
      continue;
    }

    const stackClaim =
      /\b(using|with|built with|building with|developed with|developing with|implemented with|powered by)\b/i.test(
        sentence
      );

    if (!stackClaim) {
      continue;
    }

    if (!roleSupportsTechnologies(technologies)) {
      issues.push(
        `Possible cross-company technology mixing: ${technologies.join(", ")}`
      );
    }
  }

  return issues;
}

/*
 * ----------------------------------------
 * Risky responsibility bundles
 * ----------------------------------------
 */

function compoundClaimIssues(text) {
  const sentences = splitSentences(text);

  const issues = [];

  for (const sentence of sentences) {
    const normalized = normalize(sentence);

    const signals = [
      normalized.includes("technical leadership"),

      normalized.includes("ci cd"),

      normalized.includes("gitlab ci"),

      normalized.includes("mentor"),

      normalized.includes("code reviews"),

      normalized.includes("refactoring"),

      normalized.includes("performance"),

      normalized.includes("reliability"),
    ];

    const count = signals.filter(Boolean).length;

    /*
     * Too many unrelated concepts in one
     * sentence encourages false relationships.
     */
    if (count >= 5) {
      issues.push(
        "Summary sentence bundles too many unrelated professional claims"
      );
    }
  }

  return issues;
}

/*
 * ----------------------------------------
 * Ollama
 * ----------------------------------------
 */

async function generate(prompt, { attempts = 3, retryDelayMs = 1200 } = {}) {
  let lastError;

  const systemPrompt =
    "You write conservative professional resume summaries. Never invent experience, technologies, metrics, responsibilities, outcomes, frequency, causal relationships, seniority, expertise level, or company-specific technology combinations. Prefer descriptive career-wide statements over inferred outcomes. Use only the supplied verified professional evidence. Return only valid JSON matching the provided schema.";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // The script no longer cares who fulfills this request
      const rawResponse = await generateText({
        systemPrompt,
        userPrompt: prompt,
        jsonSchema: summaryJsonSchema,
      });

      const parsed = summarySchema.parse(JSON.parse(rawResponse));
      return parsed.summary.trim();
    } catch (error) {
      lastError = error;

      if (attempt >= attempts) break;

      console.log(
        `LLM attempt ${attempt} failed; retrying in ${retryDelayMs}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError;
}

/*
 * ----------------------------------------
 * Prompt evidence
 * ----------------------------------------
 */

const roleEvidenceForPrompt = workEvidence
  .filter((role) => role.bullets.length > 0)
  .map(
    (role) => `
ROLE:
${role.company} — ${role.position}

VERIFIED BULLETS:
${role.bullets.map((bullet) => `- ${bullet}`).join("\n")}
`
  )
  .join("\n");

/*
 * ----------------------------------------
 * Prompt
 * ----------------------------------------
 */

const prompt = `
Rewrite the professional summary for this resume.

TARGET ROLE:
${plan.job?.title ?? "Senior Software Engineer"}

TARGET COMPANY:
${plan.job?.company ?? "the target company"}

GOAL:
Write a concise, factual 2-3 sentence professional summary emphasizing a SMALL NUMBER of the strongest VERIFIED facts relevant to the target role.

IMPORTANT:
You are summarizing a CAREER, not a single project.

Do not try to mention every supported requirement.

Prefer descriptive career-wide statements over inferred outcomes.

SAFE STYLE EXAMPLES:
- "Senior Software Engineer with 8+ years of experience building scalable backend systems, REST APIs, and enterprise applications."
- "Professional experience includes Node.js, JavaScript, MongoDB, gRPC, GCP, CI/CD, automated testing, code reviews, mentoring, and technical leadership."

UNSAFE STYLE EXAMPLES:
- "Mentoring engineers and leading refactoring improves reliability."
- "CI/CD and code reviews ensure quality."
- "Node.js and MongoDB services using GCP" unless the same role explicitly supports that stack.
- "Maintained high availability" when availability is only documented as an engineering concern.

STRICT RULES:
- Use ONLY VERIFIED ROLE EVIDENCE below for professional experience.
- You may preserve general career facts already present in ORIGINAL SUMMARY, including "8+ years of experience".
- Do not invent technologies, responsibilities, metrics, outcomes, industries, frequency, ownership, architecture claims, or causal relationships.
- Do not imply that technologies from different companies were used together unless a verified bullet explicitly supports that combination.
- Do not claim professional React experience.
- Do not mention unsupported job requirements.
- Do not mention AWS, GraphQL, RDS, NestJS, React Native, Azure, SLAs, or scalable microservices.
- Do not describe the candidate as an expert.
- Do not use "deep expertise".
- Do not use "ensure", "guarantee", "maintain high", "deliver high", or similar guarantee-style language.
- Do not claim CI/CD ownership stronger than the verified evidence.
- Do not invent code review frequency.
- Do not create causal relationships between mentoring, refactoring, code quality, reliability, availability, or performance unless the SAME verified bullet explicitly supports that relationship.
- Availability and request performance are supported as engineering concerns in one Sidia project; do not claim that high availability or high performance was achieved, maintained, guaranteed, or delivered.
- Do not attach availability or performance outcomes to refactoring unless explicitly supported by the same verified bullet.
- Avoid "enhances", "improves", "results in", "leads to", or similar causal language unless directly supported.
- Avoid first-person wording such as "I design", "I lead", or "I ensure".
- Prefer neutral resume-summary wording such as "Senior Software Engineer with..." and "Professional experience includes..."
- Prioritize a small number of the strongest target-relevant facts.
- Do not try to mention every supported requirement.
- Do not mention the company being applied to.
- Do not describe career objectives.
- Write in English.
- Use 30-85 words.
- Use exactly 2 or 3 sentences.
- Do not explain your answer.

SUPPORTED TARGET TERMS:
${targetCoverage
  .map((item) => `- ${item.term} (${item.category}, ${item.status})`)
  .join("\n")}

ORIGINAL SUMMARY:
${originalSummary}

VERIFIED ROLE EVIDENCE:
${roleEvidenceForPrompt}
`;

const proposedSummary = await generate(prompt);

/*
 * ----------------------------------------
 * Validation
 * ----------------------------------------
 */

const issues = [
  ...unsupportedTermIssues(proposedSummary),

  ...technologyIssues(proposedSummary),

  ...numberIssues(proposedSummary),

  ...lengthIssues(proposedSummary),

  ...sentenceIssues(proposedSummary),

  ...forbiddenClaimsIssues(proposedSummary),

  ...causalStrengtheningIssues(proposedSummary),

  ...causalConnectorIssues(proposedSummary),

  ...crossCompanyMixingIssues(proposedSummary),

  ...compoundClaimIssues(proposedSummary),
];

const accepted = issues.length === 0;

const finalSummary = accepted ? proposedSummary : originalSummary;

/*
 * Safe fallback:
 * rejected summaries never replace
 * the existing verified summary.
 */
const finalResume = {
  ...resume,

  basics: {
    ...resume.basics,

    summary: finalSummary,
  },
};

const report = {
  model: currentProvider(),

  generatedAt: new Date().toISOString(),

  target: {
    company: plan.job?.company ?? null,

    title: plan.job?.title ?? null,
  },

  original: originalSummary,

  proposed: proposedSummary,

  accepted,

  final: finalSummary,

  issues,

  professionalTechnologies,

  unsupportedTerms,

  targetCoverage,

  roleEvidence: workEvidence.map((role) => ({
    company: role.company,

    position: role.position,

    technologies: role.technologies,

    bulletCount: role.bullets.length,
  })),
};

await fs.writeFile(outputPath, JSON.stringify(finalResume, null, 2), "utf8");

await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log("\nSUMMARY");

console.log("-------");

console.log(proposedSummary);

if (accepted) {
  console.log("\n✓ Summary accepted");
} else {
  console.log("\n✗ Summary rejected");

  for (const issue of issues) {
    console.log(`  - ${issue}`);
  }

  console.log("\nOriginal summary preserved.");
}

console.log(`\nFinal resume: ${outputPath}`);

console.log(`Summary report: ${reportPath}`);
