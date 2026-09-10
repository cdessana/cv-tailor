import { assertExtraction } from "../extraction-contract.mjs";
import { validateEvidence } from "../validate-evidence.mjs";
import {
  canonicalizeBlockRecords,
  createBlockContract,
  normalizeEmptyBlocks,
} from "./block-contract.mjs";

export function createBatchPlan(input, batchSize) {
  const contract = createBlockContract(input);
  const ids = contract.blocks.map((block) => block.id);
  const batches = [];
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const targetIds = ids.slice(offset, offset + batchSize);
    const targetSet = new Set(targetIds);
    const sections = input.sections
      .map((section) => ({
        ...section,
        units: section.units.filter((unit) => targetSet.has(unit.id)),
      }))
      .filter((section) => section.units.length);
    const document = { ...input, sections };
    batches.push({
      number: batches.length + 1,
      targetIds,
      sections,
      document,
      contract: createBlockContract(document),
      processedIds: ids.slice(0, offset + targetIds.length),
    });
  }
  return { contract, ids, batches, total: batches.length };
}

export function validateProviderBlockResponse(
  document,
  blocksResponse,
  { errorCode, makeError, logger = console, debug = false } = {}
) {
  const contract = createBlockContract(document);
  try {
    canonicalizeBlockRecords(blocksResponse, (warning) =>
      logger.warn?.(`[job-parser] ${JSON.stringify(warning)}`)
    );
    const shapeErrors = contract.shapeErrors(blocksResponse);
    if (shapeErrors.length)
      throw new TypeError(
        `Invalid block response: ${JSON.stringify(shapeErrors)}`
      );
    contract.reconcile(blocksResponse, (warning) =>
      logger.warn?.(`[job-parser] ${JSON.stringify(warning)}`)
    );
    normalizeEmptyBlocks(blocksResponse, contract.blocks, (warning) =>
      logger.warn?.(`[job-parser] ${JSON.stringify(warning)}`)
    );
    if (debug)
      logger.debug?.(
        `[job-parser] Extraction after normalization: ${JSON.stringify(blocksResponse)}`
      );
    const feedback = contract.inspect(blocksResponse);
    if (debug)
      logger.debug?.(
        `[job-parser] Inspection feedback: ${JSON.stringify(feedback)}`
      );
    if (feedback.length) {
      const failure = makeError(
        errorCode,
        `Provider output failed intermediate schema validation: ${JSON.stringify(feedback)}`
      );
      failure.invalidBlockIds = [
        ...new Set(feedback.map((error) => error.blockId).filter(Boolean)),
      ];
      failure.blocksResponse = structuredClone(blocksResponse);
      throw failure;
    }
    const extraction = contract.assemble(blocksResponse, debug ? logger : {});
    assertExtraction(extraction);
    const evidence = validateEvidence(document, extraction);
    if (!evidence.valid)
      throw makeError(
        errorCode,
        `Provider output failed evidence validation: ${JSON.stringify(evidence.errors)}`
      );
    return { extraction, blocks: blocksResponse.blocks };
  } catch (error) {
    if (error.code === errorCode) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    const compact = detail.length > 2400 ? `${detail.slice(0, 2400)}…` : detail;
    const failure = makeError(
      errorCode,
      `Provider output failed validation: ${compact}`,
      error
    );
    if (Array.isArray(error.invalidBlockIds))
      failure.invalidBlockIds = error.invalidBlockIds;
    if (error.blocksResponse) failure.blocksResponse = error.blocksResponse;
    throw failure;
  }
}

export function updateConfirmedMetadata(
  input,
  processedIds,
  combined,
  current = {}
) {
  const processedSet = new Set(processedIds);
  const document = {
    ...input,
    sections: input.sections
      .map((section) => ({
        ...section,
        units: section.units.filter((unit) => processedSet.has(unit.id)),
      }))
      .filter((section) => section.units.length),
  };
  return createBlockContract(document).assemble(combined).metadata ?? current;
}

export function finalizeProviderBatches(
  input,
  combined,
  makeError,
  evidenceErrorCode
) {
  const extraction = createBlockContract(input).assemble(combined);
  const evidence = validateEvidence(input, extraction);
  if (!evidence.valid)
    throw makeError(evidenceErrorCode, JSON.stringify(evidence.errors));
  return extraction;
}

export async function runCorrectionLoop({
  maxCorrections,
  request,
  validate,
  createCorrection,
  isCorrectable,
  onCorrection = () => {},
}) {
  let correction;
  for (let attempt = 0; attempt <= maxCorrections; attempt += 1) {
    let response;
    try {
      response = await request(correction, attempt);
      return await validate(response, attempt);
    } catch (error) {
      if (attempt === maxCorrections || !isCorrectable(error, response))
        throw error;
      correction = await createCorrection(error, response, attempt);
      await onCorrection(attempt + 1, error);
    }
  }
  throw new TypeError("Correction loop ended without a result.");
}
