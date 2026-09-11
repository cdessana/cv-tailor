import Ajv from "ajv";
import { createBlockSchema, createValidationSchema } from "./gemini-schema.mjs";
import { validateEvidence, restoreSourceCase } from "../validate-evidence.mjs";
import { assertExtraction } from "../extraction-contract.mjs";
import { deriveCoverage } from "../coverage.mjs";
import { mergeMetadataRecord } from "../metadata.mjs";
import { validateItemSemantics } from "../validate-item-semantics.mjs";
import { canonicalizeDirectAlternative } from "../canonicalize-alternatives.mjs";

const normalized = (value) => value.replace(/\s+/gu, " ").trim();

function safeEmptyExclusion(block) {
  const text = normalized(block.text);
  if (
    block.signal &&
    ["required", "preferred", "responsibilities", "competencies"].includes(
      block.signal
    )
  )
    return null;
  if (
    /^(?:about the team|about the job|how to apply|apply now|benefits|perks|sobre a vaga|benefícios|candidate-se)[:.!?]?$/iu.test(
      text
    )
  ) {
    return "Recognized standalone heading or navigation label; no substantive source text excluded.";
  }
  return null;
}

const signaledFallbacks = new Map([
  ["required", { kind: "requirement", classification: "required" }],
  ["preferred", { kind: "requirement", classification: "preferred" }],
  [
    "responsibilities",
    { kind: "responsibility", classification: "not-applicable" },
  ],
  ["competencies", { kind: "competency", classification: "ambiguous" }],
]);

function qualifiedAlternativeFallback(block, descriptor, value) {
  if (!["required", "preferred"].includes(descriptor.classification))
    return null;
  const prepositions = /\b(?:using|with|of|in)\s+/giu;
  let tail;
  for (const match of value.matchAll(prepositions))
    tail = value.slice(match.index + match[0].length);
  if (!tail || !/\s+(?:or|ou)\s+/iu.test(tail)) return null;
  const values = tail
    .replace(/[.;]\s*$/u, "")
    .split(/\s*,\s*(?:(?:or|ou)\s+)?|\s+(?:or|ou)\s+/iu)
    .map((option) => option.trim());
  if (
    values.length < 2 ||
    values.length > 6 ||
    values.some(
      (option) =>
        !option ||
        option.split(/\s+/u).length > 8 ||
        !/^[\p{L}\p{N}][\p{L}\p{N} +#./-]*$/u.test(option)
    ) ||
    new Set(values.map((option) => option.toLocaleLowerCase())).size !==
      values.length
  )
    return null;
  return {
    type: "alternative",
    operator: "anyOf",
    values,
    ...descriptor,
    evidence: { quote: block.text },
    ...(block.heading ? { sourceSection: block.heading } : {}),
  };
}

function signaledBulletFallback(block) {
  const descriptor = signaledFallbacks.get(block.signal);
  if (!descriptor || block.type !== "bullet") return null;
  const value = block.text
    .replace(/^\s*(?:[-*+]|\d+[.)]|[•◦▪])\s+/u, "")
    .trim();
  if (!value) return null;
  const qualifiedAlternative = qualifiedAlternativeFallback(
    block,
    descriptor,
    value
  );
  if (qualifiedAlternative) return qualifiedAlternative;
  return canonicalizeDirectAlternative({
    type: "item",
    value,
    ...descriptor,
    evidence: { quote: block.text },
    ...(block.heading ? { sourceSection: block.heading } : {}),
  });
}

function sectionSignalMismatch(block, record, metadataKey) {
  if (metadataKey || !block.signal) return null;
  if (["required", "preferred"].includes(block.signal)) {
    if (
      !["skill", "requirement", "competency"].includes(record.kind) ||
      record.classification !== block.signal
    )
      return `Content under ${block.signal} must retain that qualification classification.`;
  } else if (
    block.signal === "responsibilities" &&
    (record.kind !== "responsibility" ||
      record.classification !== "not-applicable")
  ) {
    return "Content under responsibilities must remain a responsibility.";
  } else if (block.signal === "competencies" && record.kind !== "competency") {
    return "Content under competencies must remain a competency.";
  }
  return null;
}

export function normalizeEmptyBlocks(response, blocks, onExclusion = () => {}) {
  for (const block of blocks) {
    const result = response.blocks?.[block.id];
    if (
      result?.status === "extracted" &&
      !result.items.length &&
      !result.alternatives.length &&
      !Object.keys(result.metadata ?? {}).length
    ) {
      const reason = safeEmptyExclusion(block);
      if (reason) {
        result.status = "excluded";
        result.reason = reason;
        onExclusion({
          code: "empty_block_excluded",
          blockId: block.id,
          reason,
        });
      }
    }
  }
  return response;
}

const alternativeKeys = new Set([
  "type",
  "operator",
  "kind",
  "classification",
  "values",
  "evidence",
  "sourceSection",
]);

/**
 * Gemini occasionally puts a fully formed alternative record in `items`.
 * Moving that exact record is lossless. This deliberately refuses records with
 * unknown fields or incomplete alternatives, which remain validation errors.
 */
export function canonicalizeBlockRecords(response, onChange = () => {}) {
  for (const [blockId, result] of Object.entries(response.blocks ?? {})) {
    if (!Array.isArray(result.items) || !Array.isArray(result.alternatives))
      continue;
    const ordinary = [];
    for (const record of result.items) {
      if (
        record?.type === "alternative" &&
        Object.keys(record).every((key) => alternativeKeys.has(key)) &&
        record.operator === "anyOf" &&
        Array.isArray(record.values) &&
        record.values.length >= 2
      ) {
        result.alternatives.push(record);
        onChange({
          code: "misplaced_alternative_canonicalized",
          blockId,
          reason:
            "Moved a complete anyOf record from items to alternatives without changing values or evidence.",
        });
      } else {
        const canonical = canonicalizeDirectAlternative(record);
        if (canonical?.type === "alternative") {
          result.alternatives.push(canonical);
          onChange({
            code: "direct_alternative_canonicalized",
            blockId,
            reason:
              "Converted a standalone direct choice to anyOf without changing evidence.",
          });
        } else ordinary.push(canonical);
      }
    }
    result.items = ordinary;
  }
  return response;
}

/** Bind source text to its ID in a provider request and require each ID in the response. */
export function createBlockContract(document) {
  const blocks = (document.sections ?? []).flatMap((section) =>
    section.units.map((unit) => ({
      id: unit.id,
      type: unit.type,
      heading: section.heading?.text ?? null,
      signal: section.signal,
      role: section.role ?? "unknown",
      text: unit.originalText,
    }))
  );
  const ids = blocks.map((block) => block.id);
  if (
    ids.some((id) => typeof id !== "string" || !id) ||
    new Set(ids).size !== ids.length
  ) {
    throw new TypeError("Source blocks require unique nonempty IDs.");
  }
  const schema = createValidationSchema(blocks);
  const toolSchema = createBlockSchema(blocks);
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
  const shapeErrors = (response) =>
    validate(response) ? [] : structuredClone(validate.errors);

  // Operates only on a decoded copy; the raw provider artifact is never changed.
  function reconcile(response, onChange = () => {}) {
    const errors = shapeErrors(response);
    if (errors.length)
      throw new TypeError(`Invalid block response: ${JSON.stringify(errors)}`);
    for (const block of blocks) {
      const result = response.blocks[block.id];
      for (const record of [
        ...result.items,
        ...result.alternatives,
        ...Object.values(result.metadata),
      ]) {
        if (!normalized(block.text).includes(normalized(record.evidence.quote)))
          continue;
        if (record.values) {
          record.values = record.values.map((value) =>
            restoreSourceCase(value, record.evidence.quote)
          );
        } else
          record.value = restoreSourceCase(record.value, record.evidence.quote);
        for (const example of record.examples ?? []) {
          example.value = restoreSourceCase(
            example.value,
            record.evidence.quote
          );
        }
      }
    }
    // When a small model silently discards a whole bullet whose heading already
    // establishes its role, retain that exact source statement locally. Apply
    // the fallback only if it passes the same contract checks as model output.
    for (const block of blocks) {
      const result = response.blocks[block.id];
      if (
        result.status !== "excluded" ||
        result.items.length ||
        result.alternatives.length ||
        Object.keys(result.metadata).length
      )
        continue;
      const fallback = signaledBulletFallback(block);
      if (!fallback) continue;
      const proposed = structuredClone(response);
      const proposedResult = proposed.blocks[block.id];
      proposedResult.status = "extracted";
      proposedResult.reason = "";
      if (fallback.type === "alternative")
        proposedResult.alternatives.push(fallback);
      else proposedResult.items.push(fallback);
      if (inspect(proposed).some((error) => error.blockId === block.id))
        continue;
      response.blocks[block.id] = proposedResult;
      onChange({
        code: "signaled_bullet_preserved",
        blockId: block.id,
        from: "excluded",
        to: "extracted",
        originalReason: result.reason,
        reason:
          "Preserved the complete source bullet using its recognized section signal.",
      });
    }
    // Only reconcile an exclusion when every contained record passes the same
    // shape, classification, grounding and metadata-role checks as extraction.
    const proposed = structuredClone(response);
    const targets = blocks.filter((block) => {
      const result = proposed.blocks[block.id];
      if (
        result.status !== "excluded" ||
        !(
          result.items.length ||
          result.alternatives.length ||
          Object.keys(result.metadata).length
        )
      )
        return false;
      result.status = "extracted";
      result.reason = "";
      return true;
    });
    const feedback = inspect(proposed);
    for (const block of targets) {
      if (
        feedback.some((error) => !error.blockId || error.blockId === block.id)
      )
        continue;
      const originalReason = response.blocks[block.id].reason;
      response.blocks[block.id] = proposed.blocks[block.id];
      onChange({
        code: "block_status_corrected",
        blockId: block.id,
        from: "excluded",
        to: "extracted",
        originalReason,
        reason:
          "Retained all schema-valid, source-backed records despite the contradictory excluded status.",
      });
    }
    return response;
  }

  // Check all safely readable records before assembly can stop at its first error.
  function inspect(response) {
    if (!validate(response)) return structuredClone(validate.errors);
    const errors = [];
    for (const block of blocks) {
      const result = response.blocks?.[block.id];
      const path = `/${block.id}`;
      if (!result) {
        errors.push({
          blockId: block.id,
          path,
          message: `Missing block in response: ${block.id}.`,
        });
        continue;
      }
      const records = [
        ...result.items.map((record, index) => ({
          record,
          path: `${path}/items/${index}`,
        })),
        ...result.alternatives.map((record, index) => ({
          record,
          path: `${path}/alternatives/${index}`,
        })),
        ...Object.entries(result.metadata).map(([key, record]) => ({
          record,
          key,
          path: `${path}/metadata/${key}`,
        })),
      ];
      if (result.status === "extracted" && !records.length) {
        errors.push({
          blockId: block.id,
          path,
          message: `Block ${block.id} is marked extracted but has no items or metadata.`,
        });
      } else if (result.status !== "extracted" && records.length) {
        errors.push({
          blockId: block.id,
          path,
          message: `Non-extracted block ${block.id} must not contain records.`,
        });
      }
      if (
        result.status === "excluded" &&
        ["required", "preferred", "responsibilities", "competencies"].includes(
          block.signal
        ) &&
        normalized(block.text)
      ) {
        errors.push({
          blockId: block.id,
          path,
          code: "suspicious_signaled_exclusion",
          message: `Substantive content under a ${block.signal} heading must not be silently excluded.`,
          instruction:
            "Extract the complete source-backed qualification, responsibility, or competency. If its meaning truly cannot be represented, mark it unresolved with a specific reason.",
        });
      }
      for (const entry of records) {
        const { record, key } = entry;
        const details = {
          blockId: block.id,
          path: entry.path,
          value: record.value ?? record.values,
          quote: record.evidence.quote,
          instruction:
            "Copy the quote from this source block and each value from that quote exactly, preserving capitalization and verb forms. Do not paraphrase or invent values.",
        };
        const mismatch = sectionSignalMismatch(block, record, key);
        if (mismatch) {
          errors.push({
            ...details,
            code: "section_signal_mismatch",
            message: mismatch,
            instruction:
              "Use the enclosing heading's explicit role and classification; do not promote, weaken, or reinterpret it.",
          });
        }
        if (
          key === "location" &&
          normalized(record.evidence.quote)
            .toLocaleLowerCase()
            .startsWith(`${normalized(record.value).toLocaleLowerCase()}:`)
        ) {
          errors.push({
            ...details,
            code: "metadata_role_mismatch",
            message:
              "Evidence labels this value as a company or organization, not a job location.",
            instruction:
              "Use company for organization names and location only for geographic places.",
          });
        }
        if (
          key === "location" &&
          /\b(?:remote|remoto|remota|hybrid|híbrido|híbrida|onsite|on-site|presencial)\b/iu.test(
            String(record.value)
          )
        ) {
          errors.push({
            ...details,
            code: "invalid_location",
            message:
              "Location must be geographic and must not contain a work arrangement.",
            instruction:
              "Copy only the geographic place; omit remote, hybrid, or onsite labels.",
          });
        }
        if (
          !normalized(block.text).includes(normalized(record.evidence.quote))
        ) {
          errors.push({
            ...details,
            code: "evidence_not_in_block",
            message: `Evidence must occur in its source block: ${block.id}.`,
          });
        }
        const extraction = key
          ? { items: [], metadata: { [key]: record } }
          : { items: [record] };
        try {
          assertExtraction(extraction);
        } catch (error) {
          errors.push({
            ...details,
            code: "invalid_intermediate",
            message: error.message,
          });
          continue;
        }
        // Use the same strict checks as the final evidence gate, including aliases.
        if (!key) {
          for (const error of validateItemSemantics(record, {
            metadata: result.metadata,
          })) {
            errors.push({
              ...details,
              ...error,
              path: entry.path + error.path,
            });
          }
        }
        for (const error of validateEvidence(document, extraction).errors) {
          const prefix = key ? `/metadata/${key}` : "/items/0";
          errors.push({
            ...details,
            ...error,
            path: entry.path + error.path.slice(prefix.length),
            ...(key === "workArrangement"
              ? {
                  instruction:
                    "Copy the complete source-backed work arrangement, preserving hashtags such as #remotefirst and conditions such as sempre que a função permitir. Do not strip punctuation or infer unrestricted remote work.",
                }
              : {}),
          });
        }
      }
    }
    return errors;
  }

  function assemble(response, logger = {}) {
    if (!validate(response))
      throw new TypeError(
        `Invalid block response: ${JSON.stringify(validate.errors)}`
      );
    let extraction = { items: [], coverage: [] };
    for (const block of blocks) {
      const result = response.blocks?.[block.id];
      if (!result)
        throw new TypeError(`Missing block in response: ${block.id}`);
      if (result.status !== "extracted") {
        if (
          result.items.length ||
          result.alternatives.length ||
          Object.keys(result.metadata).length
        ) {
          throw new TypeError(
            `Non-extracted block ${block.id} must not contain records.`
          );
        }
        extraction.coverage.push({
          unitId: block.id,
          status: result.status,
          reason: result.reason,
        });
        continue;
      }
      if (
        !result.items.length &&
        !result.alternatives.length &&
        !Object.keys(result.metadata ?? {}).length
      ) {
        throw new TypeError(
          `Block ${block.id} is marked extracted but has no items or metadata.`
        );
      }
      function attach(record) {
        if (
          !normalized(record.evidence.quote) ||
          !normalized(block.text).includes(normalized(record.evidence.quote))
        ) {
          throw new TypeError(
            `Evidence must occur in its source block: ${block.id}.`
          );
        }
        return { ...structuredClone(record), sourceUnitIds: [block.id] };
      }
      extraction.items.push(
        ...result.items.map(attach),
        ...result.alternatives.map(attach)
      );
      for (const [key, record] of Object.entries(result.metadata ?? {})) {
        const attached = attach(record);
        extraction.metadata ??= {};

        extraction.metadata[key] = mergeMetadataRecord(
          extraction.metadata[key],
          attached,
          key
        );
      }
    }
    // Metadata repeated in multiple blocks still accounts for every occurrence.
    const repeatedMetadata = new Map();
    for (const block of blocks) {
      const result = response.blocks?.[block.id];
      if (
        result &&
        result.status === "extracted" &&
        !result.items.length &&
        !result.alternatives.length &&
        Object.keys(result.metadata ?? {}).length &&
        !Object.values(extraction.metadata ?? {}).some((record) =>
          record.sourceUnitIds.includes(block.id)
        )
      ) {
        repeatedMetadata.set(block.id, {
          unitId: block.id,
          status: "excluded",
          reason:
            "Source-backed metadata retained in the candidate collection; primary value retained from another block.",
        });
      }
    }
    logger.debug?.("[job-parser] Applying coverage.");
    extraction.coverage.push(...repeatedMetadata.values());
    logger.debug?.("[job-parser] Deriving coverage.");
    const accounted = deriveCoverage(document, extraction);
    logger.debug?.(`[job-parser] Accounting valid: ${accounted.valid}`);
    if (!accounted.valid)
      throw new TypeError(
        `Block accounting failed: ${JSON.stringify(accounted.errors)}`
      );
    return accounted.extraction;
  }
  return {
    blocks,
    schema,
    toolSchema,
    assemble,
    inspect,
    shapeErrors,
    reconcile,
  };
}
