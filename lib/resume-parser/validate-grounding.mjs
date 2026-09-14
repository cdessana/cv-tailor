import { inspectDateRange } from "./dates.mjs";

const profileNetworkPath = /^\/basics\/profiles\/\d+\/network$/u;
const datePath = /\/(?:startDate|endDate|date)$/u;
const numberPattern = /\d+(?:[.,]\d+)?%?/gu;

function canonical(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/u, "")
    .replace(/[*_`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function pointerSegment(value) {
  return String(value).replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function scalarFields(value, path = "") {
  if (Array.isArray(value)) return value.flatMap((item, index) => scalarFields(item, `${path}/${index}`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => scalarFields(child, `${path}/${pointerSegment(key)}`));
  }
  return value == null ? [] : [{ path, value }];
}

function issue(code, message, path, source = null) {
  return { code, message, path, source, severity: "error", requiresHumanReview: false, kind: "grounding" };
}

function sourceForPath(path, provenance) {
  return provenance.find((entry) => entry.path === path)
    ?? provenance.find((entry) => path.startsWith(`${entry.path}/`));
}

function sourceIsInDocument(source, document) {
  if (!source || typeof source !== "object" || !source.text) return false;
  if (sourceOrder(source, document) >= 0) return true;
  if (!Number.isInteger(source.page) || !Number.isInteger(source.lineStart) || !Number.isInteger(source.lineEnd)) return false;
  const range = document.lines.filter((line) => (
    line.source?.page === source.page
    && line.source?.lineStart >= source.lineStart
    && line.source?.lineEnd <= source.lineEnd
  ));
  return range.length > 0 && canonical(range.map((line) => line.text).join(" ")).includes(canonical(source.text));
}

function datesFromSource(sourceText) {
  const candidates = [sourceText, ...sourceText.split("|").map((part) => part.trim())];
  return candidates.flatMap((candidate) => {
    const result = inspectDateRange(candidate).value;
    return result ? [result.startDate, result.endDate].filter(Boolean) : [];
  });
}

function valuesGrounded(field, sourceText) {
  if (profileNetworkPath.test(field.path)) {
    const expected = /linkedin/iu.test(sourceText) ? "linkedin" : "website";
    return canonical(field.value) === expected;
  }
  if (datePath.test(field.path)) return datesFromSource(sourceText).includes(String(field.value));
  return canonical(sourceText).includes(canonical(field.value));
}

function changedNumbers(field, sourceText) {
  const values = String(field.value).match(numberPattern) ?? [];
  if (!values.length || datePath.test(field.path)) return false;
  const sourceValues = new Set(sourceText.match(numberPattern) ?? []);
  return values.some((value) => !sourceValues.has(value));
}

function sourceOrder(source, document) {
  return document.lines.findIndex((line) => line.source === source || (
    line.source?.page === source?.page
    && line.source?.lineStart === source?.lineStart
    && line.source?.text === source?.text
  ));
}

function crossRoleIssues(provenance, document) {
  const workEntries = new Map();
  for (const entry of provenance) {
    const match = entry.path.match(/^\/work\/(\d+)\/(.+)$/u);
    if (!match) continue;
    const index = Number(match[1]);
    const field = match[2];
    const order = sourceOrder(entry.source, document);
    if (order < 0) continue;
    const record = workEntries.get(index) ?? { anchors: [], highlights: [] };
    if (/^(?:name|position|startDate|endDate|location)$/u.test(field)) record.anchors.push(order);
    if (/^highlights\/\d+$/u.test(field)) record.highlights.push({ entry, order });
    workEntries.set(index, record);
  }
  const indexes = [...workEntries.keys()].sort((left, right) => left - right);
  const anchors = new Map(indexes.map((index) => [index, Math.min(...workEntries.get(index).anchors)]));
  const issues = [];
  indexes.forEach((index, position) => {
    const start = anchors.get(index);
    const end = anchors.get(indexes[position + 1]) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(start)) return;
    for (const highlight of workEntries.get(index).highlights) {
      if (highlight.order < start || highlight.order >= end) {
        issues.push(issue("cross_role_evidence", "A work highlight is sourced outside its work entry boundaries.", highlight.entry.path, highlight.entry.source));
      }
    }
  });
  return issues;
}

export function validateResumeGrounding({ resume, provenance, document }) {
  const issues = [];
  for (const field of scalarFields(resume)) {
    const evidence = sourceForPath(field.path, provenance);
    if (!evidence) {
      issues.push(issue("missing_provenance", "The extracted value has no source provenance.", field.path));
      continue;
    }
    if (!sourceIsInDocument(evidence.source, document)) {
      issues.push(issue("invalid_provenance_source", "The provenance source is not present in the source document.", field.path, evidence.source));
      continue;
    }
    if (changedNumbers(field, evidence.source.text)) {
      issues.push(issue("modified_numeric_value", "A numeric value is not supported by its provenance source.", field.path, evidence.source));
      continue;
    }
    if (!valuesGrounded(field, evidence.source.text)) {
      issues.push(issue(datePath.test(field.path) ? "invented_date_precision" : "ungrounded_value", "The extracted value is not supported by its provenance source.", field.path, evidence.source));
    }
  }
  issues.push(...crossRoleIssues(provenance, document));
  return issues;
}
