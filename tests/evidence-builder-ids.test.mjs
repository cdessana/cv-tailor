import assert from "node:assert/strict";
import test from "node:test";
import { stableId } from "../lib/evidence/builder.mjs";

test("stable evidence IDs are deterministic, namespaced, and selector-safe", () => {
  const claim = stableId("claim", "Context A", "Fact with spaces");
  assert.equal(claim, stableId("claim", "context a", "fact with spaces"));
  assert.match(claim, /^claim_[0-9a-f]{16}$/);
  assert.notEqual(claim, stableId("question", "Context A", "Fact with spaces"));
  assert.equal(/[^a-zA-Z0-9_-]/.test(claim), false);
});
