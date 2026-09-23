import assert from "node:assert/strict";
import test from "node:test";
import { buildParserStatus } from "../lib/job-parser/status.mjs";

test("clean deterministic output is successful without review", () => {
  assert.deepEqual(buildParserStatus({
    semanticProvider: { used: false, status: "not-needed" },
    warnings: [],
    diagnostics: { unresolved: [] },
  }), { status: "success", mode: "deterministic", reviewItemCount: 0 });
});

test("successful semantic enrichment is distinct from deterministic output", () => {
  assert.equal(buildParserStatus({
    semanticProvider: { used: true, status: "succeeded" },
  }).mode, "semantic_enrichment_used");
});

test("semantic failure and disabled enrichment remain successful review states", () => {
  const failed = buildParserStatus({
    semanticProvider: { used: false, status: "failed" },
    warnings: [{ code: "semantic_enrichment_failed" }],
    diagnostics: { unresolved: [{ unitId: "unit-1" }] },
  });
  assert.deepEqual(failed, {
    status: "success_with_review",
    mode: "semantic_enrichment_failed_with_fallback",
    reviewItemCount: 1,
  });
  assert.equal(buildParserStatus({
    semanticProvider: { used: false, status: "disabled" },
    warnings: [{ code: "semantic_enrichment_unavailable" }],
  }).mode, "semantic_enrichment_disabled");
});
