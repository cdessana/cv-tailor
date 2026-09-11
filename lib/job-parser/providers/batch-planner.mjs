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
