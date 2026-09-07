import { isDeepStrictEqual } from "node:util";
import { preprocessJobDescription } from "./preprocess.mjs";
import { aliasComparisonKey } from "./validate-aliases.mjs";
import {
  aliasIndex,
  assertExtraction,
  defaultAliases,
} from "./extraction-contract.mjs";

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

function capture(text, signal, index) {
  const statement = text.replace(/[.!]$/u, "").trim();
  if (
    /\b(not|no|never|without|optional|unless|except|if|but|however)\b/iu.test(
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
    /\b(and|is|are|required|preferred|must|should|have|with|which|that|including|such|either)\b/iu.test(
      value
    ) ||
    /[;:!?()\r\n]/u.test(value) ||
    /\.\s/u.test(value)
  )
    return null;
  if (/^or\b|\bor$/iu.test(value)) return null;
  const hasOr = /\s+or\s+/iu.test(value);
  const values = hasOr ? value.split(/\s*,\s*(?:or\s+)?|\s+or\s+/iu) : [value];
  if (!hasOr && value.includes(",")) return null;
  // An Oxford/comma list must end with an explicit OR connector.
  if (
    value.includes(",") &&
    (!/\bor\s+[^,]+$/iu.test(value) ||
      (value.match(/\bor\b/giu) ?? []).length !== 1)
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
  const match = text.match(/^(.+?)\s+is hiring (?:an?\s+)?(.+)$/iu) ??
    text.match(/^(.+?)\s+is looking for (?:an?\s+)?(.+)$/iu);
  if (!match) return null;
  const company = match[1].trim();
  const title = match[2].replace(/[.!]$/u, "").trim();
  if (!company || !title || title.split(/\s/u).length > 10) return null;
  return {
    company: { value: company, evidence: { quote: unit.originalText } },
    title: { value: title, evidence: { quote: unit.originalText } },
  };
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
  const metadata = {};
  for (const section of document.sections) {
    for (const unit of section.units) {
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
  const extraction = { ...(Object.keys(metadata).length ? { metadata } : {}), items };
  assertExtraction(extraction);
  return { extraction, unresolved };
}
