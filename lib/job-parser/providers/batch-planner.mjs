import { createBlockContract } from "./block-contract.mjs";

export function estimateTokens(value, charactersPerToken = 3) {
  return Math.ceil(
    (typeof value === "number"
      ? value
      : typeof value === "string"
        ? value.length
        : JSON.stringify(value).length) / charactersPerToken
  );
}

export function createAdaptiveBatchPlan(
  input,
  {
    maxBlocks,
    maxPromptTokens = Number.POSITIVE_INFINITY,
    responseTokenReserve = 0,
    contextSize = Number.POSITIVE_INFINITY,
    fixedCharacters = 0,
    charactersPerToken = 3,
  }
) {
  const contract = createBlockContract(input);
  const ids = contract.blocks.map((block) => block.id);
  const promptBudget = Math.min(
    maxPromptTokens,
    contextSize - responseTokenReserve
  );
  if (!Number.isInteger(maxBlocks) || maxBlocks <= 0)
    throw new TypeError("maxBlocks must be a positive integer.");
  if (!(promptBudget > 0))
    throw new TypeError(
      "The semantic-provider prompt budget must be positive."
    );

  const groups = [];
  let current = [];
  const estimatedTokensFor = (blocks) =>
    estimateTokens(
      fixedCharacters + JSON.stringify(blocks).length,
      charactersPerToken
    );

  for (const block of contract.blocks) {
    const candidate = [...current, block];
    if (
      current.length &&
      (candidate.length > maxBlocks ||
        estimatedTokensFor(candidate) > promptBudget)
    ) {
      groups.push(current);
      current = [block];
    } else current = candidate;
  }
  if (current.length) groups.push(current);

  const batches = groups.map((blocks, index) => {
    const targetIds = blocks.map((block) => block.id);
    const targetSet = new Set(targetIds);
    const sections = input.sections
      .map((section) => ({
        ...section,
        units: section.units.filter((unit) => targetSet.has(unit.id)),
      }))
      .filter((section) => section.units.length);
    const document = { ...input, sections };
    return {
      number: index + 1,
      targetIds,
      sections,
      document,
      contract: createBlockContract(document),
      processedIds: ids.slice(0, ids.indexOf(targetIds.at(-1)) + 1),
      estimatedPromptTokens: estimatedTokensFor(blocks),
      exceedsPromptBudget: estimatedTokensFor(blocks) > promptBudget,
    };
  });
  return { contract, ids, batches, total: batches.length, promptBudget };
}

function selectSections(input, targetIds) {
  const targetSet = new Set(targetIds);
  return input.sections
    .map((section) => ({
      ...section,
      units: section.units.filter((unit) => targetSet.has(unit.id)),
    }))
    .filter((section) => section.units.length);
}

export function restrictPlannedBatch(input, batch, targetIds) {
  const allowed = new Set(batch.targetIds);
  if (
    !targetIds.length ||
    new Set(targetIds).size !== targetIds.length ||
    targetIds.some((id) => !allowed.has(id))
  )
    throw new TypeError(
      "Restricted batch IDs must be a nonempty batch subset."
    );
  const sections = selectSections(input, targetIds);
  const document = { ...input, sections };
  return {
    ...batch,
    targetIds: [...targetIds],
    sections,
    document,
    contract: createBlockContract(document),
    estimatedPromptTokens: Math.ceil(
      batch.estimatedPromptTokens * (targetIds.length / batch.targetIds.length)
    ),
    exceedsPromptBudget: false,
  };
}

export function splitPlannedBatch(input, batch) {
  if (batch.targetIds.length < 2) return null;
  const midpoint = Math.ceil(batch.targetIds.length / 2);
  const groups = [
    batch.targetIds.slice(0, midpoint),
    batch.targetIds.slice(midpoint),
  ];
  return groups.map((targetIds, index) => ({
    ...restrictPlannedBatch(input, batch, targetIds),
    splitDepth: (batch.splitDepth ?? 0) + 1,
    splitPart: index + 1,
  }));
}
