/**
 * A stable, consumer-facing summary of a completed parser run.  This remains
 * in the parser boundary so callers do not need to infer outcomes from raw
 * provider implementation details.
 */
export function buildParserStatus({ semanticProvider, warnings = [], diagnostics = {} } = {}) {
  const unresolved = diagnostics.unresolved ?? [];
  const codes = new Set(warnings.map((warning) => warning.code));
  let mode = "deterministic";

  if (semanticProvider?.used && semanticProvider?.status === "succeeded") {
    mode = "semantic_enrichment_used";
  } else if (semanticProvider?.status === "failed" || codes.has("semantic_enrichment_failed")) {
    mode = "semantic_enrichment_failed_with_fallback";
  } else if (
    semanticProvider?.status === "disabled" ||
    semanticProvider?.status === "misconfigured" ||
    codes.has("semantic_enrichment_unavailable")
  ) {
    mode = "semantic_enrichment_disabled";
  }

  return {
    status: warnings.length || unresolved.length ? "success_with_review" : "success",
    mode,
    reviewItemCount: unresolved.length,
  };
}
