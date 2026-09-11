import assert from "node:assert/strict";
import test from "node:test";
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import {
  createAdaptiveBatchPlan,
  estimateTokens,
  splitPlannedBatch,
} from "../lib/job-parser/providers/batch-planner.mjs";

function document(count, text = "A moderately sized requirement") {
  return preprocessJobDescription(
    [
      "Requirements",
      ...Array.from({ length: count }, (_, i) => `- ${text} ${i}`),
    ].join("\n")
  );
}

test("token estimation accepts text, objects, and explicit character counts", () => {
  assert.equal(estimateTokens("123456", 3), 2);
  assert.equal(estimateTokens({ value: "x" }, 1), 13);
  assert.equal(estimateTokens(12, 3), 4);
});

test("adaptive planning preserves source order and respects the block ceiling", () => {
  const input = document(7);
  const plan = createAdaptiveBatchPlan(input, { maxBlocks: 3 });
  assert.deepEqual(
    plan.batches.map((batch) => batch.targetIds.length),
    [3, 3, 1]
  );
  assert.deepEqual(
    plan.batches.flatMap((batch) => batch.targetIds),
    plan.ids
  );
});

test("prompt budget creates smaller batches before the block ceiling", () => {
  const input = document(4, "x".repeat(120));
  const plan = createAdaptiveBatchPlan(input, {
    maxBlocks: 4,
    maxPromptTokens: 100,
    fixedCharacters: 30,
    charactersPerToken: 3,
  });
  assert.ok(plan.batches.length > 1);
  assert.ok(
    plan.batches.every(
      (batch) =>
        batch.estimatedPromptTokens <= plan.promptBudget ||
        batch.targetIds.length === 1
    )
  );
});

test("response reserve reduces the available context budget", () => {
  const plan = createAdaptiveBatchPlan(document(1), {
    maxBlocks: 3,
    maxPromptTokens: 10000,
    contextSize: 5000,
    responseTokenReserve: 1200,
  });
  assert.equal(plan.promptBudget, 3800);
});

test("an oversized single block is retained and marked for later fallback", () => {
  const plan = createAdaptiveBatchPlan(document(1, "x".repeat(600)), {
    maxBlocks: 3,
    maxPromptTokens: 50,
  });
  assert.equal(plan.batches.length, 1);
  assert.equal(plan.batches[0].targetIds.length, 1);
  assert.equal(plan.batches[0].exceedsPromptBudget, true);
});

test("splitting preserves order and cumulative processed IDs", () => {
  const input = document(5);
  const parent = createAdaptiveBatchPlan(input, { maxBlocks: 5 }).batches[0];
  const children = splitPlannedBatch(input, parent);
  assert.deepEqual(
    children.map((child) => child.targetIds.length),
    [3, 2]
  );
  assert.deepEqual(
    children.flatMap((child) => child.targetIds),
    parent.targetIds
  );
  assert.deepEqual(children[1].processedIds, parent.processedIds);
  assert.equal(children[0].splitDepth, 1);
});

test("a single-block batch cannot be split further", () => {
  const input = document(1);
  const batch = createAdaptiveBatchPlan(input, { maxBlocks: 1 }).batches[0];
  assert.equal(splitPlannedBatch(input, batch), null);
});
