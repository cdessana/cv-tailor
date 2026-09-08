import Ajv from "ajv";
import { createBlockSchema, createValidationSchema } from "./gemini-schema.mjs";
import { validateEvidence } from "../validate-evidence.mjs";
import { assertExtraction } from "../extraction-contract.mjs";
import { deriveCoverage } from "../coverage.mjs";

const normalized = value => value.replace(/\s+/gu, " ").trim();

const isTeamNoise = value => /\b(?:squad|team|time|equipe|department|departamento|área)\b/iu.test(value);

function safeEmptyExclusion(block) {
  const text = normalized(block.text);
  const heading = normalized(block.heading ?? "");
  if (block.signal && ["required", "preferred", "responsibilities", "competencies"].includes(block.signal)) return null;
  if (heading && text.length <= 120) return "This source block is a heading or structural label without extractable records.";
  if (heading && /^(?:about(?: the)?|what we(?:'|’)re looking for|minimum requirements|apply|how to apply|benefits|perks|equal opportunity)\b/iu.test(text)) {
    return "This source block is navigation or general job information without extractable records.";
  }
  if (/(?:company|team|mission|investors|funding|product|platform)\b[\s\S]*(?:not|does not|without)\b[\s\S]*(?:requirement|qualification)/iu.test(text)) {
    return "This source block is company context without candidate requirements.";
  }
  return null;
}

export function normalizeEmptyBlocks(response, blocks) {
  for (const block of blocks) {
    const result = response.blocks?.[block.id];
    if (result?.status === "extracted" && !result.items.length && !result.alternatives.length && !Object.keys(result.metadata ?? {}).length) {
      const reason = safeEmptyExclusion(block);
      if (reason) { result.status = "excluded"; result.reason = reason; }
    }
  }
  return response;
}

/** Bind source text to its ID in the request and require each ID in the response. */
export function createBlockContract(document) {
  const blocks = (document.sections ?? []).flatMap(section => section.units.map(unit => ({
    id: unit.id, heading: section.heading?.text ?? null,
    signal: section.signal, text: unit.originalText,
  })));
  const ids = blocks.map(block => block.id);
  if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
    throw new TypeError("Source blocks require unique nonempty IDs.");
  }
  const schema = createValidationSchema(blocks);
  const toolSchema = createBlockSchema(blocks);
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);

  // Check all safely readable records before assembly can stop at its first error.
  function inspect(response) {
    if (!validate(response)) return structuredClone(validate.errors);
    const errors = [];
    for (const block of blocks) {
      const result = response.blocks?.[block.id];
      const path = `/${block.id}`;
      if (!result) {
        errors.push({ blockId: block.id, path, message: `Missing block in response: ${block.id}.` });
        continue;
      }
      const records = [
        ...result.items.map((record, index) => ({ record, path: `${path}/items/${index}` })),
        ...result.alternatives.map((record, index) => ({ record, path: `${path}/alternatives/${index}` })),
        ...Object.entries(result.metadata).map(([key, record]) => ({ record, key, path: `${path}/metadata/${key}` })),
      ];
      if (result.status === "extracted" && !records.length) {
        errors.push({ blockId: block.id, path, message: `Block ${block.id} is marked extracted but has no items or metadata.` });
      } else if (result.status !== "extracted" && records.length) {
        errors.push({ blockId: block.id, path, message: `Non-extracted block ${block.id} must not contain records.` });
      }
      for (const entry of records) {
        const { record, key } = entry;
        const details = { blockId: block.id, path: entry.path, value: record.value ?? record.values, quote: record.evidence.quote,
          instruction: "Copy the quote from this source block and each value from that quote exactly, preserving capitalization and verb forms. Do not paraphrase or invent values." };
        if (key === "location" && normalized(record.evidence.quote).toLocaleLowerCase().startsWith(`${normalized(record.value).toLocaleLowerCase()}:`)) {
          errors.push({ ...details, code: "metadata_role_mismatch", message: "Evidence labels this value as a company or organization, not a job location.", instruction: "Use company for organization names and location only for geographic places." });
        }
        if (key === "location" && /\b(?:remote|remoto|remota|hybrid|híbrido|híbrida|onsite|on-site|presencial)\b/iu.test(String(record.value))) {
          errors.push({ ...details, code: "invalid_location", message: "Location must be geographic and must not contain a work arrangement.", instruction: "Copy only the geographic place; omit remote, hybrid, or onsite labels." });
        }
        if (!normalized(block.text).includes(normalized(record.evidence.quote))) {
          console.error(`Evidence mismatch for block ${block.id}:`);
          console.error(`Block text: ${normalized(block.text)}`);
          console.error(`Quote: ${normalized(record.evidence.quote)}`);
          errors.push({ ...details, code: "evidence_not_in_block", message: `Evidence must occur in its source block: ${block.id}.` });
        }
        const extraction = key ? { items: [], metadata: { [key]: record } } : { items: [record] };
        try {
          assertExtraction(extraction);
        } catch (error) {
          errors.push({ ...details, code: "invalid_intermediate", message: error.message });
          continue;
        }
        // Use the same strict checks as the final evidence gate, including aliases.
        for (const error of validateEvidence(document, extraction).errors) {
          const prefix = key ? `/metadata/${key}` : "/items/0";
          errors.push({ ...details, ...error, path: entry.path + error.path.slice(prefix.length) });
        }
      }
    }
    return errors;
  }

  function assemble(response, logger = console) {
    if (!validate(response)) throw new TypeError(`Invalid block response: ${JSON.stringify(validate.errors)}`);
    let extraction = { items: [], coverage: [] };
    for (const block of blocks) {
      const result = response.blocks?.[block.id];
      if (!result) throw new TypeError(`Missing block in response: ${block.id}`);
      if (result.status !== "extracted") {
        if (result.items.length || result.alternatives.length || Object.keys(result.metadata).length) {
          throw new TypeError(`Non-extracted block ${block.id} must not contain records.`);
        }
        extraction.coverage.push({ unitId: block.id, status: result.status, reason: result.reason });
        continue;
      }
      if (!result.items.length && !result.alternatives.length && !Object.keys(result.metadata ?? {}).length) {
        throw new TypeError(`Block ${block.id} is marked extracted but has no items or metadata.`);
      }
      function attach(record) {
        if (!normalized(record.evidence.quote) || !normalized(block.text).includes(normalized(record.evidence.quote))) {
          throw new TypeError(`Evidence must occur in its source block: ${block.id}.`);
        }
        return { ...structuredClone(record), sourceUnitIds: [block.id] };
      }
      extraction.items.push(...result.items.map(attach), ...result.alternatives.map(attach));
      for (const [key, record] of Object.entries(result.metadata ?? {})) {
        const attached = attach(record);
        extraction.metadata ??= {};
        
        // Initialize metadata entry as a candidate collection
        if (!extraction.metadata[key]) {
          extraction.metadata[key] = { ...attached, candidates: [attached] };
          continue;
        }

        const entry = extraction.metadata[key];
        const isNewValue = !entry.candidates.some(c => normalized(c.value).toLocaleLowerCase() === normalized(record.value).toLocaleLowerCase());
        
        if (isNewValue) {
          entry.candidates.push(attached);
        }

        // Maintain the most "authoritative" record as the primary value.
        // Prefer first discovered non-noise value; only upgrade for refinements or to escape noise.
        const currentVal = normalized(entry.value);
        const nextVal = normalized(record.value);
        const left = currentVal.toLocaleLowerCase();
        const right = nextVal.toLocaleLowerCase();

        const currentIsNoise = key === "title" && isTeamNoise(currentVal);
        const nextIsNoise = key === "title" && isTeamNoise(nextVal);

        let upgrade = false;
        if (currentIsNoise && !nextIsNoise) {
          upgrade = true;
        } else if (currentIsNoise === nextIsNoise) {
          // If both clean (or both noise), only upgrade for clear refinements (superset)
          if (right.includes(left) && right.length > left.length) {
            upgrade = true;
          } else if (right === left && record.evidence.quote.length > entry.evidence.quote.length) {
            // Same normalized value, prefer better evidence
            upgrade = true;
          }
        }

        if (upgrade) {
          Object.assign(entry, attached);
        }
      }
    }
    // Metadata repeated in multiple blocks still accounts for every occurrence.
    const repeatedMetadata = new Map();
    for (const block of blocks) {
      const result = response.blocks?.[block.id];
      if (result && result.status === "extracted" && !result.items.length && !result.alternatives.length && Object.keys(result.metadata ?? {}).length
        && !Object.values(extraction.metadata ?? {}).some(record => record.sourceUnitIds.includes(block.id))) {
        repeatedMetadata.set(block.id, { unitId: block.id, status: "excluded", reason: "Duplicate source-backed metadata retained from another block." });
      }
    }
    logger.debug?.("[job-parser] Applying coverage.");
    extraction.coverage.push(...repeatedMetadata.values());
    logger.debug?.("[job-parser] Deriving coverage.");
    const accounted = deriveCoverage(document, extraction);
    logger.debug?.(`[job-parser] Accounting valid: ${accounted.valid}`);
    if (!accounted.valid) throw new TypeError(`Block accounting failed: ${JSON.stringify(accounted.errors)}`);
    return accounted.extraction;
  }
  return { blocks, schema, toolSchema, assemble, inspect };
}
