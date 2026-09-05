import fs from "node:fs/promises";
import path from "node:path";

const MODEL = process.env.OLLAMA_MODEL || "granite4.2:3b-q4_K_S";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1200;

const [resumePath, planPath, outputPathArg, reportPathArg] =
  process.argv.slice(2);

if (!resumePath || !planPath) {
  console.error(
    "Usage: node scripts/rewrite.mjs <resume.json> <tailoring-plan.json> [output.json] [report.json]"
  );
  process.exit(1);
}

const planDir = path.dirname(planPath);

const outputPath = outputPathArg || path.join(planDir, "resume-rewritten.json");

const reportPath = reportPathArg || path.join(planDir, "rewrite-report.json");

const resume = JSON.parse(await fs.readFile(resumePath, "utf8"));

const plan = JSON.parse(await fs.readFile(planPath, "utf8"));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function phraseExists(text, phrase) {
  const haystack = normalize(text);

  const needle = normalize(phrase);

  if (!haystack || !needle) {
    return false;
  }

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sentence(text) {
  const value = String(text || "").trim();

  if (!value) {
    return "";
  }

  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function numbers(text = "") {
  return [...String(text).matchAll(/\b\d+(?:[.,]\d+)?%?\b/g)].map(
    (match) => match[0]
  );
}

function introducedNumbers(source, proposed) {
  const allowed = new Set(numbers(source));

  return unique(numbers(proposed).filter((value) => !allowed.has(value)));
}

const TECH_TERMS = [
  "AWS",
  "Azure",
  "GCP",
  "Google Cloud",
  "Google Cloud Platform",
  "Google Cloud Pub/Sub",
  "Node.js",
  "JavaScript",
  "TypeScript",
  "React",
  "React Native",
  "Angular",
  "NestJS",
  "GraphQL",
  "MongoDB",
  "RDS",
  "PostgreSQL",
  "MySQL",
  "SQL Server",
  "Java",
  "Kotlin",
  "Spring Boot",
  "Python",
  "Flask",
  "C#",
  ".NET",
  ".NET Core",
  ".NET 5",
  ".NET 6",
  "WPF",
  "gRPC",
  "REST",
  "REST API",
  "REST APIs",
  "RESTful API",
  "RESTful APIs",
  "RPC",
  "GitLab CI",
  "CI/CD",
  "Entity Framework",
  "Entity Framework Core",
  "LINQ",
  "Swagger",
  "Serilog",
  "JWT",
  "Docker",
  "Kubernetes",
  "Kafka",
  "RabbitMQ",
  "Redis",
  "DynamoDB",
  "Oracle",
  "Terraform",
];

function mentionedTechnologies(text) {
  return TECH_TERMS.filter((term) => phraseExists(text, term));
}

function getUnsupportedTerms() {
  return unique([
    ...(plan.unsupportedTerms || []),
    ...(plan.doNotAdd || []),
    ...(plan.doNotAddTerms || []),
    ...(plan.analysis?.unsupportedTerms || []),
  ]);
}

const unsupportedTerms = getUnsupportedTerms();

function candidateSourceText(candidate) {
  if (candidate.type === "resume-bullet") {
    return candidate.text || "";
  }

  return [
    ...(candidate.facts || []),
    ...(candidate.priorityFacts || []),
    ...(candidate.skills || []),
  ].join(" ");
}

function evidenceFacts(candidate) {
  return unique([
    ...(candidate.priorityFacts || []),
    ...(candidate.facts || []),
  ]);
}

function evidenceSpecificRule(candidate) {
  return EVIDENCE_RULES[candidate.evidenceId] || null;
}

const EVIDENCE_RULES = {
  "sidia-node-mongodb": {
    requiredTerms: ["Node.js", "JavaScript", "MongoDB"],
    optionalTerms: [],
    minOptionalMatches: 0,
  },

  "sidia-grpc-dotnet6": {
    requiredTerms: ["gRPC"],
    optionalTerms: ["REST APIs"],
    minOptionalMatches: 0,
  },

  "sidia-node-high-volume": {
    requiredTerms: ["high-volume"],
    optionalTerms: ["availability", "request performance"],
    minOptionalMatches: 1,
  },
};

function evidenceRule(candidate) {
  return EVIDENCE_RULES[candidate.evidenceId] || null;
}

function requiredTermsFor(candidate) {
  const rule = evidenceRule(candidate);

  return unique([
    ...(candidate.requiredTerms || []),
    ...(candidate.distinctiveRule?.requiredTerms || []),
    ...(rule?.requiredTerms || []),
  ]);
}

function optionalTermsFor(candidate) {
  const rule = evidenceRule(candidate);

  return unique([
    ...(candidate.optionalTerms || []),
    ...(candidate.distinctiveRule?.optionalTerms || []),
    ...(rule?.optionalTerms || []),
  ]);
}

function minOptionalMatchesFor(candidate) {
  const rule = evidenceRule(candidate);

  return Math.max(
    candidate.distinctiveRule?.minOptionalMatches || 0,
    rule?.minOptionalMatches || 0
  );
}

function deterministicEvidenceFallback(candidate) {
  const facts = evidenceFacts(candidate);

  if (!facts.length) {
    return "";
  }

  const requiredTerms = requiredTermsFor(candidate);

  const specificRule = evidenceSpecificRule(candidate);

  const selected = [];

  /*
   * First preserve every required
   * distinctive fact we can identify.
   */
  for (const required of requiredTerms) {
    const matching = facts.find((fact) => phraseExists(fact, required));

    if (matching && !selected.includes(matching)) {
      selected.push(matching);
    }
  }

  /*
   * Distinctive optional context must
   * be satisfied using ONLY the
   * evidence-specific optional terms.
   *
   * This prevents generic terms such
   * as Node.js from satisfying a rule
   * intended to preserve availability
   * or request-performance context.
   */
  if (specificRule && specificRule.minOptionalMatches > 0) {
    let matches = 0;

    for (const fact of facts) {
      if (selected.includes(fact)) {
        continue;
      }

      const matchesSpecific = specificRule.optionalTerms.some((term) =>
        phraseExists(fact, term)
      );

      if (matchesSpecific) {
        selected.push(fact);

        matches++;

        if (matches >= specificRule.minOptionalMatches) {
          break;
        }
      }
    }
  }

  /*
   * If no distinctive rule selected
   * anything, retain the strongest
   * available factual statement.
   */
  if (selected.length === 0) {
    selected.push(facts[0]);
  }

  return selected.slice(0, 3).map(sentence).join(" ");
}

function extractJsonObject(raw) {
  const text = String(raw || "").trim();

  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  const match = text.match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error("Model response did not contain JSON.");
  }

  return JSON.parse(match[0]);
}

async function callOllama(messages) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          stream: false,
          format: "json",
          messages,
          options: {
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama returned HTTP ${response.status}`);
      }

      const data = await response.json();

      const content = data.message?.content;

      if (!content) {
        throw new Error("Ollama returned an empty response.");
      }

      const parsed = extractJsonObject(content);

      if (typeof parsed.rewritten !== "string") {
        throw new Error('Expected {"rewritten":"..."}');
      }

      return parsed.rewritten.trim();
    } catch (error) {
      lastError = error;

      if (attempt < MAX_ATTEMPTS) {
        console.log(`      Ollama attempt ${attempt} failed; retrying...`);

        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

function causalStrengtheningIssues(source, proposed) {
  const issues = [];

  const sourceNormalized = normalize(source);

  const proposedNormalized = normalize(proposed);

  /*
   * Particularly important for the
   * mentoring bullet:
   *
   * "contributing to the conversion"
   * must not become
   * "converted" / "helped convert".
   */
  const cautiousConversion = /contribut\w*\s+to\s+(?:the\s+)?conversion/.test(
    sourceNormalized
  );

  if (cautiousConversion && !/\bcontribut\w*\b/.test(proposedNormalized)) {
    issues.push(
      "causal_strengthening: cautious contribution wording was not preserved"
    );
  }

  if (
    cautiousConversion &&
    (/\bconverted\b/.test(proposedNormalized) ||
      /\bhelped\s+convert\b/.test(proposedNormalized) ||
      /\bled\s+to\s+the\s+conversion\b/.test(proposedNormalized))
  ) {
    issues.push(
      "causal_strengthening: conversion attribution became stronger than the source"
    );
  }

  const riskyPatterns = [
    {
      regex: /\bguaranteed\b/,
      label: "guaranteed",
    },
    {
      regex: /\bguaranteeing\b/,
      label: "guaranteeing",
    },
    {
      regex: /\bensured\b/,
      label: "ensured",
    },
    {
      regex: /\bensuring\b/,
      label: "ensuring",
    },
    {
      regex: /\bowned\b/,
      label: "owned",
    },
    {
      regex: /\bsolely\b/,
      label: "solely",
    },
    {
      regex: /\bsingle-handedly\b/,
      label: "single-handedly",
    },
  ];

  for (const { regex, label } of riskyPatterns) {
    if (regex.test(proposedNormalized) && !regex.test(sourceNormalized)) {
      issues.push(`semantic_strengthening: introduced "${label}"`);
    }
  }

  return issues;
}

function validateRewrite(candidate, proposed) {
  const issues = [];

  const source = candidateSourceText(candidate);

  if (!proposed || proposed.length < 10) {
    issues.push("empty_or_too_short");

    return issues;
  }

  if (
    /\b(?:here is|rewritten|resume bullet|cv bullet|bullet point)\b/i.test(
      proposed
    )
  ) {
    issues.push("meta_text");
  }

  const newNumbers = introducedNumbers(source, proposed);

  if (newNumbers.length) {
    issues.push(`introduced_numbers: ${newNumbers.join(", ")}`);
  }

  for (const term of unsupportedTerms) {
    if (phraseExists(proposed, term)) {
      issues.push(`unsupported_term: ${term}`);
    }
  }

  /*
   * Detect a technology introduced by
   * the model that did not exist in
   * this candidate's factual context.
   */
  const allowedTechText = [
    source,
    ...(candidate.skills || []),
    ...(candidate.requiredTerms || []),
    ...(candidate.optionalTerms || []),
  ].join(" ");

  for (const technology of mentionedTechnologies(proposed)) {
    if (!phraseExists(allowedTechText, technology)) {
      issues.push(`introduced_technology: ${technology}`);
    }
  }

  for (const required of requiredTermsFor(candidate)) {
    if (!phraseExists(proposed, required)) {
      issues.push(`missing_required_term: ${required}`);
    }
  }

  const optionalTerms = optionalTermsFor(candidate);

  const minOptional = minOptionalMatchesFor(candidate);

  if (minOptional > 0) {
    const optionalMatches = optionalTerms.filter((term) =>
      phraseExists(proposed, term)
    ).length;

    if (optionalMatches < minOptional) {
      issues.push(
        `missing_optional_context: expected ${minOptional}, found ${optionalMatches}`
      );
    }
  }

  const specificRule = evidenceSpecificRule(candidate);

  if (specificRule && specificRule.minOptionalMatches > 0) {
    const matches = specificRule.optionalTerms.filter((term) =>
      phraseExists(proposed, term)
    ).length;

    if (matches < specificRule.minOptionalMatches) {
      issues.push(
        `missing_distinctive_context: expected ${specificRule.minOptionalMatches} of [${specificRule.optionalTerms.join(", ")}], found ${matches}`
      );
    }
  }

  /*
   * Preserve the full DDD name whenever
   * the original evidence contains it.
   */
  if (
    phraseExists(source, "Domain-Driven Design") &&
    !phraseExists(proposed, "Domain-Driven Design")
  ) {
    issues.push("ddd_full_name_removed");
  }

  issues.push(...causalStrengtheningIssues(source, proposed));

  return issues;
}

function systemPrompt() {
  return `
You rewrite resume bullets conservatively.

You MUST preserve factual meaning.

Rules:
- Never invent technologies, tools, numbers, scope, outcomes, ownership, seniority, causality or responsibility.
- Never combine facts from different projects.
- Never strengthen "contributed to" into "caused", "converted", "ensured", "guaranteed", or equivalent language.
- If the source says someone contributed to an outcome, preserve that cautious attribution.
- Keep concrete technologies that are important to the supplied evidence.
- If the source contains "Domain-Driven Design (DDD)", preserve the full phrase "Domain-Driven Design (DDD)".
- Project leadership does not imply direct people management. Do not turn "worked with two other people" into "led two team members" unless that relationship is explicitly stated.
- Use concise professional English.
- One bullet only.
- Do not add explanations or commentary.

Return JSON only:
{"rewritten":"..."}
`.trim();
}

function userPromptForResumeBullet(candidate) {
  return `
Rewrite this resume bullet conservatively.

SOURCE:
${candidate.text}

REQUIRED TERMS:
${requiredTermsFor(candidate).join(", ") || "none"}

OPTIONAL TERMS:
${optionalTermsFor(candidate).join(", ") || "none"}

Do not introduce any facts not present in SOURCE.
`.trim();
}

function userPromptForEvidence(candidate) {
  return `
Create one concise resume bullet using ONLY the factual evidence below.

EVIDENCE ID:
${candidate.evidenceId || candidate.id}

FACTS:
${(candidate.facts || []).map((fact) => `- ${fact}`).join("\n")}

SKILLS EXPLICITLY SUPPORTED BY THIS EVIDENCE:
${(candidate.skills || []).join(", ") || "none"}

REQUIRED TERMS:
${requiredTermsFor(candidate).join(", ") || "none"}

OPTIONAL TERMS:
${optionalTermsFor(candidate).join(", ") || "none"}

Do not infer causal relationships between facts.
Do not combine this evidence with facts from another project.
`.trim();
}

async function rewriteCandidate(candidate) {
  const source =
    candidate.type === "evidence"
      ? {
          evidenceId: candidate.evidenceId || candidate.id,
          facts: candidate.facts || [],
          skills: candidate.skills || [],
          coverageReason: candidate.coverageReason || [],
          requiredTerms: candidate.requiredTerms || [],
          optionalTerms: candidate.optionalTerms || [],
          priorityFacts: candidate.priorityFacts || [],
          distinctiveRule: candidate.distinctiveRule || null,
        }
      : candidate.text;

  let proposed = null;
  let generationError = null;

  try {
    proposed = await callOllama([
      {
        role: "system",
        content: systemPrompt(),
      },
      {
        role: "user",
        content:
          candidate.type === "evidence"
            ? userPromptForEvidence(candidate)
            : userPromptForResumeBullet(candidate),
      },
    ]);
  } catch (error) {
    generationError = error instanceof Error ? error.message : String(error);
  }

  /*
   * Critical behavior:
   *
   * A failure while generating from
   * evidence must NOT make the factual
   * evidence disappear from the CV.
   */
  if (generationError && candidate.type === "evidence") {
    const fallback = deterministicEvidenceFallback(candidate);

    const fallbackIssues = validateRewrite(candidate, fallback);

    return {
      candidate,
      accepted: fallbackIssues.length === 0,
      source,
      proposed: null,
      final: fallbackIssues.length === 0 ? fallback : null,
      fallback: fallbackIssues.length === 0 ? "deterministic-evidence" : null,
      generationError,
      issues: fallbackIssues,
    };
  }

  /*
   * Existing resume bullets are already
   * factual. If Ollama is unavailable,
   * preserve the original bullet.
   */
  if (generationError && candidate.type === "resume-bullet") {
    return {
      candidate,
      accepted: true,
      source,
      proposed: null,
      final: candidate.text,
      fallback: "original-resume-bullet",
      generationError,
      issues: [],
    };
  }

  const issues = validateRewrite(candidate, proposed);

  if (issues.length === 0) {
    return {
      candidate,
      accepted: true,
      source,
      proposed,
      final: proposed,
      fallback: null,
      generationError: null,
      issues: [],
    };
  }

  /*
   * Unsafe rewrite of an existing
   * resume bullet -> retain the original.
   */
  if (candidate.type === "resume-bullet") {
    return {
      candidate,
      accepted: false,
      source,
      proposed,
      final: candidate.text,
      fallback: "original-resume-bullet",
      generationError: null,
      issues,
    };
  }

  /*
   * Unsafe LLM output from evidence ->
   * use deterministic factual fallback.
   */
  const fallback = deterministicEvidenceFallback(candidate);

  const fallbackIssues = validateRewrite(candidate, fallback);

  return {
    candidate,
    accepted: fallbackIssues.length === 0,
    source,
    proposed,
    final: fallbackIssues.length === 0 ? fallback : null,
    fallback: fallbackIssues.length === 0 ? "deterministic-evidence" : null,
    generationError: null,
    issues: [...issues, ...fallbackIssues.map((issue) => `fallback:${issue}`)],
  };
}

function getRoles(plan) {
  if (Array.isArray(plan.roles)) {
    return plan.roles;
  }

  if (Array.isArray(plan.work)) {
    return plan.work;
  }

  if (Array.isArray(plan.selectedRoles)) {
    return plan.selectedRoles;
  }

  throw new Error("Could not find roles in tailoring plan.");
}

function getRoleCandidates(role) {
  if (Array.isArray(role.selectedCandidates)) {
    return role.selectedCandidates;
  }

  if (Array.isArray(role.selected)) {
    return role.selected;
  }

  if (Array.isArray(role.items)) {
    return role.items;
  }

  if (Array.isArray(role.candidates)) {
    const explicitlySelected = role.candidates.filter(
      (candidate) => candidate.selected === true
    );

    return explicitlySelected.length ? explicitlySelected : role.candidates;
  }

  return [];
}

function roleCompany(role) {
  return role.company || role.name || role.organization || "";
}

function rolePosition(role) {
  return role.position || role.title || "";
}

function sameRole(work, role) {
  return (
    normalize(work.name) === normalize(roleCompany(role)) &&
    normalize(work.position) === normalize(rolePosition(role))
  );
}

const rewrittenResume = structuredClone(resume);

const report = {
  model: MODEL,
  generatedAt: new Date().toISOString(),
  roles: [],
};

const roles = getRoles(plan);

for (const role of roles) {
  const company = roleCompany(role);

  const position = rolePosition(role);

  console.log(`\n${company} — ${position}`);

  const roleReport = {
    company,
    position,
    items: [],
  };

  const candidates = getRoleCandidates(role);

  const rewrittenHighlights = [];

  for (const candidate of candidates) {
    const result = await rewriteCandidate(candidate);

    roleReport.items.push(result);

    if (result.final) {
      rewrittenHighlights.push(result.final);
    }

    const type = candidate.type || "candidate";

    if (result.generationError && result.fallback) {
      console.log(`  ↪ ${type}: Ollama failed; used ${result.fallback}`);

      console.log(`      ${result.final}`);

      continue;
    }

    if (result.issues.length) {
      console.log(`  ↪ ${type}: unsafe rewrite rejected`);

      for (const issue of result.issues) {
        console.log(`      ${issue}`);
      }

      if (result.fallback) {
        console.log(`      fallback: ${result.fallback}`);

        console.log(`      ${result.final}`);
      }

      continue;
    }

    console.log(`  ✓ ${type}: ${result.final}`);
  }

  const workEntry = rewrittenResume.work?.find((work) => sameRole(work, role));

  if (workEntry) {
    workEntry.highlights = rewrittenHighlights;
  }

  report.roles.push(roleReport);
}

await fs.mkdir(path.dirname(outputPath), {
  recursive: true,
});

await fs.writeFile(outputPath, JSON.stringify(rewrittenResume, null, 2) + "\n");

await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");

console.log(`\nRewritten resume: ${outputPath}`);

console.log(`Rewrite report: ${reportPath}`);
