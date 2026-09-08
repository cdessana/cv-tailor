# Gemini semantic provider

The optional Gemini adapter implements the existing semantic-provider interface.
It reads `GEMINI_API_KEY` from the environment and returns only the strict
intermediate representation. It does not receive candidate data or write files.

The CLI uses Gemini only when unresolved content exists and `GEMINI_API_KEY` is
configured. Fully deterministic jobs do not need a key. Without a key, unresolved
content still fails explicitly.

The default model is `gemini-3.1-flash-lite`. Set `GEMINI_MODEL` to select another model supported by the account.
The request timeout defaults to 120 seconds and can be changed with
`GEMINI_TIMEOUT_MS`. Transient rate-limit and service-availability responses
are retried up to three times by default; `GEMINI_MAX_ATTEMPTS` can change this.

Gemini requests use `generationConfig.responseJsonSchema` with a provider adapter
derived from `schemas/job-parser.schema.json`. The adapter separates ordinary records and alternatives into arrays without
`anyOf`/`oneOf` unions: ordinary records require `value`; alternatives require
`operator` and at least two `values`. Kind/classification combinations remain
strictly validated by the canonical local schema. Metadata,
records, and evidence reject extra properties. `responseSchema` is not also sent.
Responses are still parsed as untrusted JSON and validated locally against the
full intermediate schema; local validation remains authoritative. Evidence
validation runs afterward through the existing semantic extraction flow.
Authentication, rate-limit, request, timeout, network, malformed-response, and
schema errors are reported with stable `GEMINI_*` categories. The key is never
logged or persisted.

Normal tests use mocked fetch responses and require no network or secret:

```sh
npm run test:gemini-provider
```

Extracted values must retain source wording and casing as contiguous spans of
contextual evidence. The prompt forbids capitalization changes, added labels,
paraphrasing, and early alias normalization. Evidence must retain classification
qualifiers: mandatory degrees and ideal backgrounds are separate requirements
and preferences. Explicit OR groups must remain alternatives. Local evidence
checks remain strict; mocked tests verify these boundaries, not live model
compliance or the semantic correctness of every classification.

The block adapter rejects malformed record shapes; it does not repair missing
values or turn metadata into requirement items.

The adapter uses the [documented Gemini JSON Schema subset](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig).
It resolves local references and converts `const` to singleton `enum`. Nonblank
strings (`minLength`/`pattern`) and duplicate alternatives (`uniqueItems`) remain
local AJV checks because they are outside that documented subset. Evidence
validation and compatibility mapping remain separate stages. Missing values are
rejected, never filled from evidence quotes.

Run `node --test tests/gemini-provider.test.mjs` offline. Tests compile the actual
outgoing request schema and check missing fields, record unions, invalid types,
classifications, and nested extra fields. A minimal reproduction of the live
missing-value response verifies local rejection and raw debug capture. These
checks do not substitute for a live model acceptance or completeness test.

## Source accounting and classification

The request contains ordered SOURCE BLOCKS with each unit ID, original text,
heading and section signal together. There is no separate offset index to
cross-reference. All blocks remain visible as document context for classification;
a record's evidence must be copied from its own block.

The response is a `blocks` object keyed by the exact supplied IDs. The request
schema requires every key and rejects unknown keys. It uses a shared `$defs`
block definition rather than duplicating the full record schema per unit.

```json
{
  "blocks": {
    "unit-0-16": {
      "status": "extracted",
      "items": [],
      "alternatives": [],
      "reason": "",
      "metadata": {"company": {"value": "Example", "evidence": {"quote": "Company: Example"}}}
    },
    "unit-100-120": {"status": "excluded", "items": [], "alternatives": [], "metadata": {}, "reason": "Benefits only"}
  }
}
```

Every block requires the same five fields: `status`, `items`, `alternatives`,
`metadata`, and `reason`. Use ordinary records only in items and anyOf records
only in alternatives. An extracted block must contain at least one record or
metadata value. Excluded/unresolved blocks must have empty arrays and metadata,
and a nonblank reason. Unresolved blocks fail acceptance. These conditional
rules are enforced locally without nested provider schema branches. The model
sends no coverage array, sourceUnitIds, metadataKeys or itemIndices.

Local code validates the block response, attaches sourceUnitIds from the enclosing
block, assembles the canonical intermediate extraction, and derives coverage.
Missing blocks, misplaced evidence and conflicting metadata fail explicitly.
Repeated identical metadata is retained once; a metadata-only duplicate block is
accounted for locally as duplicate metadata. Raw artifacts contain the provider's
block response; intermediate artifacts retain assembled items, metadata and
locally generated coverage. The final job schema and injected semantic provider
interface remain unchanged. Old flat Gemini response artifacts are not valid
responses to this new request contract.

This is an accounting check, not proof of semantic completeness. Paragraphs may
contain multiple qualifications; a provider can still extract too little or
supply a mistaken exclusion reason. Compare independent source-based baselines
to detect those errors. Do not interpret a coverage pass as a quality score.

The prompt distinguishes company stack from candidate qualifications, experience
requirements from behavioral competencies, and employment type from work
arrangement. Explicit source qualification evidence should take precedence over
stack mentions. An open-ended `AWS or other cloud services` choice remains an
alternative, including the generic option. No absent technologies or missing
values are filled automatically.

Run `node --test tests/gemini-blocks.test.mjs tests/job-coverage.test.mjs tests/gemini-provider.test.mjs`
for offline accounting, metadata, merge-context, and classification regressions.
Live model verification is still required after prompt changes.


## Minimal live API smoke test

In a terminal where GEMINI_API_KEY is already configured:

```sh
GEMINI_MODEL=gemini-3.1-flash-lite node scripts/job-parser-smoke.mjs
```

This sends a small synthetic JD using the actual production schema and checks
metadata, a required skill, an alternative group, evidence and mapping. It writes
no files. A request rejection retains the HTTP/GEMINI error; extraction failures
retain validation errors; a schema-valid incomplete result reports
SMOKE_CONTENT_ERROR. Exit is nonzero on any failure. This uses a live API request
and is not part of the offline suite. It must succeed before a full JD retry.
A small-request success does not prove that larger schemas or JDs will succeed.

Offline smoke coverage: `node --test tests/job-parser-smoke.test.mjs`.

### Controlled block-count diagnostic

```sh
GEMINI_MODEL=gemini-3.1-flash-lite node scripts/job-parser-schema-probe.mjs
```

Sends four live requests sequentially, for 3, 5, 10, and 15 required block keys.
The prompt, synthetic source statement, model, and record schema stay constant;
only the schema's block keys and resulting output size grow. It uses the
production provider and block adapter, with transport retries disabled so an
availability retry cannot obscure the experiment. No files are written.

Results report HTTP status, schema/request bytes, elapsed time, and whether the
response was valid. HTTP 200 with invalid output still establishes HTTP request
acceptance; HTTP 400 is request rejection. Rate limits, service errors and
network failures are inconclusive. One sample per size is not proof of a fixed
limit, and changing output size remains part of this experiment. The command
exits nonzero if any case does not produce the expected output. Raw URLs, keys,
response bodies and error messages are excluded from the diagnostic report.

Offline test: `node --test tests/job-parser-schema-probe.test.mjs`.

## Bounded production requests

`createGeminiProvider` processes at most three target source blocks per request,
sequentially. This is a conservative workaround based on observed acceptance at
three blocks and rejection at five or more; it is not a universal Gemini limit.
Each request includes the full original JD as classification context, followed by
only its target blocks. Output must cover only those target IDs and evidence must
come from each target block. Non-target context must not generate extra records.

Every batch undergoes schema, coverage and evidence validation. Results are
assembled in source order; metadata conflicts stop the run rather than choosing
one value. Full-document coverage and evidence are checked after assembly, then
the existing semantic merge, normalization and final mapping continue. A failed
batch stops further requests and no new final job is written. Existing atomic
output behavior remains unchanged.

Logs identify `batch N/total`. Retry and timeout settings apply per request;
sequential batching increases latency and API usage (15 units require five
requests). Single-batch raw debug output remains the provider JSON. Multi-batch
raw debug output is `{ "batches": [{ "batch": 1, "blockIds": [...], "response":
"raw response text" }] }`, refreshed after each received response. It includes
an invalid received response before validation, but does not invent a response
for HTTP/network failures. Intermediate/final output is only returned after all
batches succeed.

The schema-count probe deliberately uses the unbatched request helper so it
continues to measure actual 3/5/10/15-block requests. The smoke test uses the
production batched provider. Offline batching coverage:
`node --test tests/gemini-batches.test.mjs`.

### One bounded batch correction

A received response that fails JSON/schema/accounting or evidence validation
gets at most one semantic correction request for the same target batch. It
includes the prior raw response and validator feedback as data, retains the
original source context and unchanged schema, and asks for corrected complete
block results. Empty extracted blocks must receive source-backed records or an
explicit exclusion reason. Code never converts them to exclusions itself.

The corrected response passes the same validations. If it still fails, the run
stops before final output and before any later batch. HTTP, authentication,
network, and cross-batch metadata-conflict failures do not trigger this path.
Transient HTTP retries remain separately bounded by the existing request retry
setting; one semantic correction can therefore involve transport retries.

Debug envelopes identify each response by `batch` and `attempt` (1 or 2). A
single-batch run that needs correction also switches to the envelope so the
original failure is not overwritten. No correction is requested after a valid
response. This improves recovery from malformed output; it does not establish
semantic completeness or justify weakening evidence validation.

Before assembly, schema-shaped block responses are inspected across all records.
Correction feedback collects block-assignment and strict value-grounding failures
in the same attempt, with block IDs, record paths, offending values, quotes, and
an exact-copy instruction. This catches capitalization changes and rewritten verb
forms together instead of revealing them only after a block error is corrected.
Malformed wire shapes are rejected before records are inspected. Local schema,
evidence, accounting, and mapping validation remain mandatory; feedback does not
relax grounding or increase the one-correction limit.
