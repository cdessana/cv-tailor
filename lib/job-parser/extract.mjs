import { isDeepStrictEqual } from "node:util";
import { preprocessJobDescription } from "./preprocess.mjs";
import { aliasComparisonKey } from "./validate-aliases.mjs";
import {
  aliasIndex,
  assertExtraction,
  defaultAliases,
} from "./extraction-contract.mjs";
import {
  isCompanyWorkPolicy,
  isEmployerPolicyContext,
  isGenericSectionLead,
  isApplicationProcessContext,
  isResponsibilityLead,
} from "./section-content.mjs";
import { validateItemSemantics } from "./validate-item-semantics.mjs";
import { mergeMetadataRecord } from "./metadata.mjs";

// Only technology concepts already reviewed in the parser dictionary establish
// skill kind. Other captured qualifications remain generic requirements.
const technologies = new Set([
  "REST APIs",
  "GCP",
  "RPC",
  "CI/CD",
  "Node.js",
  "MongoDB",
  "Kubernetes",
  "PostgreSQL",
]);
const patterns = [
  [/^Experience with (.+) is required$/iu, "required"],
  [/^(.+) is required$/iu, "required"],
  [/^Required:\s*(.+)$/iu, "required"],
  [/^Nice to have:\s*(.+)$/iu, "preferred"],
  [/^Preferred:\s*(.+)$/iu, "preferred"],
  [/^Experience with (.+) is preferred$/iu, "preferred"],
];
const highConfidenceCandidateHeadings = new Set([
  "must haves",
  "nice to haves",
  "in this role, you will",
  "what you'll own",
  "what you'll bring",
  "it's a bonus if you have",
  "key responsibilities",
  "responsibilities",
  "your responsibilities",
  "required qualifications",
  "basic qualifications",
  "requisitos e habilidades que buscamos",
  "requirements",
  "preferred qualifications",
  "além disso, é desejável conhecimento",
  "preferred",
  "requirements description",
  "years of experience",
  "required skills/experience",
  "must-have",
  "working with",
  "foreign language",
  "desired",
  "soft skills",
  "requisitos",
  "o que você fará",
  "o que você vai fazer no seu dia a dia",
  "você assumirá as seguintes responsabilidades",
  "what you'll do",
  "who you are",
  "minimum requirements",
  "job responsibilities",
  "role responsibilities",
  "key duties",
  "qualifications",
  "skills and qualifications",
  "desired qualifications",
  "o que procuramos",
  "o que estamos procurando na pessoa que vai fazer parte do time",
  "como será seu dia a dia",
  "activities",
  "obrigatório",
  "obrigatórios",
  "diferencial",
  "diferenciais",
  "no seu dia a dia",
  "no seu dia a dia, você vai",
  "no seu dia a dia, você vai:",
  "you'll thrive in this role if you have the following skills and qualities",
]);

function capture(text, signal, index) {
  const statement = text.replace(/[.!]+$/u, "").trim();
  if (
    /\b(not|never|without|optional|unless|except|if|but|however)\b/iu.test(
      statement
    )
  )
    return { reason: "negated-or-qualified" };
  for (const [pattern, classification] of patterns) {
    const match = statement.match(pattern);
    if (match) return { value: match[1], classification };
  }
  if (signal === "required" || signal === "preferred") {
    const experience = statement.match(/^Experience with (.+)$/iu);
    if (experience) return { value: experience[1], classification: signal };
    if (technologies.has(index.get(aliasComparisonKey(statement))))
      return { value: statement, classification: signal };
  }
  return { reason: "unsupported-pattern" };
}

function options(value) {
  // Deliberately bounded phrases: clauses, sentences, AND lists and nested
  // expressions need later extraction rather than partial regex matches.
  if (
    /\b(and|is|are|required|preferred|must|should|have|with|using|which|that|including|such|either)\b/iu.test(
      value
    ) ||
    /[;:!?()\r\n]/u.test(value) ||
    /\.\s/u.test(value)
  )
    return null;
  if (/^or\b|\bor$/iu.test(value)) return null;
  const hasOr = /\s+(?:or|ou)\s+/iu.test(value);
  const values = hasOr
    ? value.split(/\s*,\s*(?:(?:or|ou)\s+)?|\s+(?:or|ou)\s+/iu)
    : [value];
  if (!hasOr && value.includes(",")) return null;
  // An Oxford/comma list must end with an explicit OR connector.
  if (
    value.includes(",") &&
    (!/\b(?:or|ou)\s+[^,]+$/iu.test(value) ||
      (value.match(/\b(?:or|ou)\b/giu) ?? []).length !== 1)
  )
    return null;
  const trimmed = values.map((part) => part.trim());
  if (
    trimmed.some(
      (part) =>
        !part ||
        part.split(/\s/u).length > 8 ||
        !/^[.\p{L}\p{N}][\p{L}\p{N} .+#/-]*$/u.test(part)
    )
  )
    return null;
  if (new Set(trimmed).size !== trimmed.length) return null;
  return trimmed;
}

function metadataFromUnit(unit) {
  const text = unit.text.trim();
  const archiveFields = new Map([
    ["company", "company"],
    ["job title", "title"],
    ["location", "location"],
    ["workplace type", "workArrangement"],
    ["employment type", "employmentType"],
    ["linkedin url", "sourceUrl"],
  ]);
  const archiveMetadata = {};
  for (const line of unit.originalText.split(/\r?\n/u)) {
    const match = line.match(/^\s*([^:]+):\s*(.*?)\s*$/u);
    if (!match) continue;
    const key = archiveFields.get(match[1].trim().toLowerCase());
    const value = match[2].trim();
    if (!key || !value || /^not specified$/iu.test(value)) continue;
    archiveMetadata[key] = {
      value,
      evidence: { quote: line.trim() },
    };
  }
  if (Object.keys(archiveMetadata).length >= 2) return archiveMetadata;
  const match =
    text.match(/^(.+?)\s+is hiring (?:an?\s+)?(.+)$/iu) ??
    text.match(/^(.+?)\s+is looking for (?:an?\s+)?(.+)$/iu);
  const about = text.match(
    /(?:^|\s)(Sobre o ([\p{L}\p{N}][\p{L}\p{N} .&'-]*?))(?=\s|$)/iu
  );
  if (
    !match &&
    about &&
    !/^(?:área|empresa|time|você)$/iu.test(about[2].trim())
  ) {
    return {
      company: { value: about[2].trim(), evidence: { quote: about[1] } },
    };
  }
  if (!match) return null;
  const company = match[1].trim();
  const title = match[2].replace(/[.!]$/u, "").trim();
  if (!company || !title || title.split(/\s/u).length > 10) return null;
  return {
    company: { value: company, evidence: { quote: unit.originalText } },
    title: { value: title, evidence: { quote: unit.originalText } },
  };
}

function keywordSkillFromUnit(section, unit) {
  if (
    unit.type !== "bullet" ||
    !/^skills?(?:\s*&\s*keywords?)?$/iu.test(section.heading?.text.trim() ?? "")
  )
    return null;
  const value = unit.text.trim();
  if (
    !value ||
    value.length > 80 ||
    value.split(/\s+/u).length > 8 ||
    /[.!?;:\r\n]/u.test(value)
  )
    return null;
  return {
    type: "item",
    value,
    kind: "skill",
    classification: "ambiguous",
    evidence: { quote: unit.originalText },
    sourceSection: section.heading.text,
  };
}

function archiveBoilerplateReason(document, unit) {
  if (!/JOB POSTING ARCHIVE:/u.test(document.originalText)) return null;
  const text = unit.text.trim();
  if (
    !/[\r\n]/u.test(unit.originalText) &&
    /^JOB POSTING ARCHIVE:\s*.+/iu.test(text)
  )
    return "Archive title repeats structured job metadata.";
  if (/^[-=]+$/u.test(text)) return "Archive separator.";
  if (/^[-=]+\s*Archived via LinkedIn Job Data Fetcher\b/iu.test(text))
    return "Archive provenance footer.";
  if (/^[-=]+\s*(?:Sobre (?:a|o) .+|About .+)$/iu.test(text))
    return "Archive separator precedes employer context.";
  if (/^[-=]+\s*Detailed job description for\b/iu.test(text))
    return "Archive summary repeats header metadata.";
  if (
    /^Location:.*\bDate Posted:.*\b(?:Official Job ID|Job ID):.*\bDirect LinkedIn Link:/isu.test(
      text
    )
  )
    return "Archive detail block repeats structured header metadata.";
  if (
    /^Key Responsibilities and Requirements can be viewed directly on LinkedIn at\b/iu.test(
      text
    )
  )
    return "Archive navigation text contains no job requirements.";
  if (/^(?:[-=]+\s*)?Req ID:\s*\S+/iu.test(text))
    return "Archive requisition identifier contains no job requirement.";
  if (
    /^(?:[\p{L}\p{N}][\p{L}\p{N} .&'-]{1,80})\s+strives to hire\b/iu.test(
      text
    ) ||
    /^We are currently seeking\b.+\bto join our team\b/iu.test(text) ||
    /^(?:[\p{L}\p{N}][\p{L}\p{N} .&'-]{1,80})\s+is looking for an?\s+(?:energetic|motivated|passionate)\b/iu.test(
      text
    ) ||
    /^Location:\s*.+/iu.test(text)
  )
    return "Archive recruiting introduction contains no independently verifiable requirement.";
  return null;
}

function contextReason(section) {
  return section.heading
    ? `Recognized context section: ${section.heading.text}.`
    : "Recognized context section.";
}

function looksLikeResponsibility(value) {
  return /^(?:you(?:'ll| will)|we(?:'ll| will) expect you to|actively\s+provide|build|contribute|continually\s+focus|develop|design|own|lead|mentor|manage|deliver|work(?:\s+(?:on|effectively|with))?|provide|perform|atuar[aá]?|desenvolver|garantir|colaborar|construir|apoiar|participar|melhorar|modelar|implementar|o profissional atuar[aá]?|você ir[aá]|você vai)\b/iu.test(
    value.trim()
  );
}

function isHighConfidenceCandidateSection(section) {
  const heading = section.heading?.text
    .replace(/[‘’]/gu, "'")
    .replace(/\.\s*$/u, "")
    .toLowerCase();
  return highConfidenceCandidateHeadings.has(heading);
}

function workArrangementFromContext(section, unit) {
  if (section.heading?.text.toLocaleLowerCase() !== "modelo de trabalho")
    return null;
  const value = unit.text.trim();
  if (
    unit.type === "bullet" ||
    !/^(?:híbrido|hybrid|remoto|remote|presencial|on-?site)\b/iu.test(value)
  )
    return null;
  return {
    value,
    evidence: { quote: unit.originalText },
    sourceSection: section.heading.text,
  };
}

function companyFromAboutHeading(section) {
  const match = section.heading?.text.match(
    /^Sobre o ([\p{L}\p{N}][\p{L}\p{N} .&'-]*?)$/iu
  );
  const value = match?.[1].trim();
  if (!value || /^(?:área|empresa|time|você)$/iu.test(value)) return null;
  return {
    value,
    evidence: { quote: section.heading.originalText },
  };
}

function signaledFallback(section, unit, index) {
  const value = unit.text.trim();
  if (
    !value ||
    !isHighConfidenceCandidateSection(section) ||
    !["required", "preferred", "responsibilities", "competencies"].includes(section.signal)
  )
    return null;
  let candidate;
  if (section.signal === "responsibilities") {
    const knowledge = value.match(/^(?:good|strong) knowledge of (.+)$/iu);
    if (knowledge) {
      candidate = {
        type: "item",
        value: knowledge[1],
        kind: "requirement",
        classification: "required",
        evidence: { quote: unit.originalText },
        ...(section.heading ? { sourceSection: section.heading.text } : {}),
      };
      return validateItemSemantics(candidate).length ? null : candidate;
    }
    // Some scraped posts mix behavioural requirements into activity sections.
    // Keep only explicit skill statements; broader narrative remains semantic.
    if (/\b(?:collaboration|communication) skills\b/iu.test(value)) {
      candidate = {
        type: "item",
        value,
        kind: "competency",
        classification: "ambiguous",
        evidence: { quote: unit.originalText },
        ...(section.heading ? { sourceSection: section.heading.text } : {}),
      };
      return validateItemSemantics(candidate).length ? null : candidate;
    }
    // Some job-board exports flatten responsibility bullets into short
    // paragraphs. Only action-led statements remain deterministic.
    if (unit.type !== "bullet" && !looksLikeResponsibility(value)) return null;
    candidate = {
      type: "item",
      value,
      kind: "responsibility",
      classification: "not-applicable",
      evidence: { quote: unit.originalText },
      ...(section.heading ? { sourceSection: section.heading.text } : {}),
    };
  } else {
    // A task accidentally placed below a qualification heading needs semantic
    // review; do not silently relabel it as a candidate requirement.
    if (looksLikeResponsibility(value)) return null;
    const values = options(value);
    const kind = section.signal === "competencies"
      ? "competency"
      : (values ?? [value]).every((part) =>
      technologies.has(index.get(aliasComparisonKey(part)))
    )
      ? "skill"
      : "requirement";
    const shared = {
      kind,
      classification: section.signal === "competencies" ? "ambiguous" : section.signal,
      evidence: { quote: unit.originalText },
      ...(section.heading ? { sourceSection: section.heading.text } : {}),
    };
    candidate = values?.length > 1
      ? { type: "alternative", operator: "anyOf", values, ...shared }
      : { type: "item", value, ...shared };
  }
  // The deterministic path may retain a full sentence, but only if that
  // sentence is already representable by the final item contract. Complex
  // alternatives remain model-owned instead of failing later during mapping.
  return validateItemSemantics(candidate).length ? null : candidate;
}

/** Extract only supported whole-unit patterns, retaining unsupported source. */
export function extract(document, dictionary = defaultAliases) {
  // Reconstruct the deterministic contract to reject forged/stale ranges and
  // malformed structures before using original excerpts as evidence.
  if (
    !document ||
    typeof document.originalText !== "string" ||
    !isDeepStrictEqual(
      document,
      preprocessJobDescription(document.originalText)
    )
  ) {
    throw new TypeError(
      "Expected an unchanged preprocessJobDescription result."
    );
  }
  const index = aliasIndex(dictionary);
  const items = [];
  const unresolved = [];
  const coverage = [];
  const metadata = {};
  for (const section of document.sections) {
    const headingCompany = companyFromAboutHeading(section);
      if (headingCompany) {
      if (!metadata.company) metadata.company = headingCompany;
      else if (
        !metadata.company.value
          .replace(/\s+/gu, " ")
          .trim()
          .toLocaleLowerCase()
          .includes(headingCompany.value.replace(/\s+/gu, " ").trim().toLocaleLowerCase()) &&
        !headingCompany.value
          .replace(/\s+/gu, " ")
          .trim()
          .toLocaleLowerCase()
          .includes(metadata.company.value.replace(/\s+/gu, " ").trim().toLocaleLowerCase())
      ) {
        metadata.company = mergeMetadataRecord(
          metadata.company,
          headingCompany,
          "company"
        );
      }
    }
    for (const unit of section.units) {
      const workArrangement = workArrangementFromContext(section, unit);
      if (workArrangement) {
        metadata.workArrangement = metadata.workArrangement
          ? mergeMetadataRecord(
              metadata.workArrangement,
              workArrangement,
              "workArrangement"
            )
          : workArrangement;
        coverage.push({
          unitId: unit.id,
          status: "metadata",
          metadataKeys: ["workArrangement"],
        });
        continue;
      }
      if (section.role === "context") {
        coverage.push({
          unitId: unit.id,
          status: "excluded",
          reason: contextReason(section),
        });
        continue;
      }
      const boilerplateReason = archiveBoilerplateReason(document, unit);
      if (boilerplateReason) {
        coverage.push({
          unitId: unit.id,
          status: "excluded",
          reason: boilerplateReason,
        });
        continue;
      }
      if (
        isGenericSectionLead(unit) ||
        isCompanyWorkPolicy(unit) ||
        isEmployerPolicyContext(unit) ||
        isApplicationProcessContext(unit) ||
        isResponsibilityLead(unit)
      ) {
        coverage.push({
          unitId: unit.id,
          status: "excluded",
          reason: isGenericSectionLead(unit)
            ? "Generic section lead contains no qualification."
            : isCompanyWorkPolicy(unit)
              ? "Company work-policy context contains no candidate qualification."
              : isEmployerPolicyContext(unit)
                ? "Employer profile or recruitment-policy context contains no candidate qualification."
                : isApplicationProcessContext(unit)
                  ? "Application-process context contains no candidate qualification."
                : "Responsibility section lead contains no independent responsibility.",
        });
        continue;
      }
      const keywordSkill = keywordSkillFromUnit(section, unit);
      if (keywordSkill) {
        items.push(keywordSkill);
        continue;
      }
      if (!section.heading && unit.type === "paragraph") {
        const detected = metadataFromUnit(unit);
        if (detected) {
          Object.assign(metadata, detected);
          continue;
        }
      }
      let result =
        section.signal === "responsibilities"
          ? { reason: "unsupported-section" }
          : capture(unit.text, section.signal, index);
      const values = result.reason ? null : options(result.value);
      if (!result.reason && !values)
        result = { reason: "unsupported-expression" };
      const fallback = result.reason ? signaledFallback(section, unit, index) : null;
      if (fallback) {
        items.push(fallback);
        continue;
      }
      if (result.reason) {
        unresolved.push({
          unit: structuredClone(unit),
          heading: structuredClone(section.heading),
          signal: section.signal,
          reason: result.reason,
        });
        continue;
      }
      const kind = values.every((value) =>
        technologies.has(index.get(aliasComparisonKey(value)))
      )
        ? "skill"
        : "requirement";
      items.push({
        ...(values.length > 1
          ? { type: "alternative", operator: "anyOf", values }
          : { type: "item", value: values[0] }),
        kind,
        classification: result.classification,
        evidence: { quote: unit.originalText },
        ...(section.heading ? { sourceSection: section.heading.text } : {}),
      });
    }
  }
  const extraction = {
    ...(Object.keys(metadata).length ? { metadata } : {}),
    items,
    ...(coverage.length ? { coverage } : {}),
  };
  assertExtraction(extraction);
  return { extraction, unresolved };
}
