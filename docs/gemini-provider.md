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

Gemini requests use the `extract_block` function declaration with a provider adapter
derived from `schemas/job-parser.schema.json`. The adapter separates ordinary records and alternatives into arrays without
`anyOf`/`oneOf` unions: ordinary records require `value`; alternatives require
`operator` and at least two `values`. Kind/classification combinations remain
strictly validated by the canonical local schema. Metadata,
records, and evidence reject extra properties locally. Function calling is forced
with `toolConfig.functionCallingConfig.mode: "ANY"`; no generationConfig response schema is sent.
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

## Fidelity-preserving canonicalization

Illustrative wording is retained when it narrows the qualification. For example,
`Experiência com soluções em Cloud, principalmente AWS` must retain `AWS` in
the ordinary requirement value; it can additionally appear in `examples`.
Illustrative lists remain non-exhaustive and do not become independent
requirements or alternatives.

Before evidence validation, the parser may canonicalize a standalone direct
choice such as `PostgreSQL or MySQL` into an `anyOf` record. It may also move a
complete `anyOf` record that Gemini placed in the `items` array into
`alternatives`. Both transformations retain the exact values and evidence. The
direct-choice rule is limited to two short values joined directly by `or`, `ou`,
`e/ou`, or `and/or`. It never parses a sentence with shared duration, role,
examples, punctuation, or other qualifiers; those remain provider-owned
structured-output decisions.

Exact duplicates are consolidated. A second, deliberately narrow rule also
consolidates two required/preferred skill or requirement records when they have
the same explicit experience duration and a shared non-generic technology term.
The more detailed wording is retained and source unit IDs from both records are
kept. Different classifications, durations, conditions, and non-duration
phrases remain separate.

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
cross-reference. Only the target blocks and their heading/section signals are sent;
a record's evidence must be copied from its own block.

The model calls `extract_block` once per target ID. One decoder checks function
names, argument shapes, duplicate/unknown IDs, and missing calls. It constructs
the following internal `blocks` envelope. The legacy single JSON-text envelope
is also accepted and goes through the same strict local validation.

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
Missing blocks and misplaced evidence fail explicitly. Distinct supported metadata
values are retained as candidates, using the existing primary-selection policy.
The mapper returns a human-validation-required warning containing the selected
value, alternatives, and evidence. This applies to all metadata fields, including
employment type and source URL. Conflicts alone do not fail parsing; unsupported
candidates do. Candidate arrays are generated locally and cannot be supplied by
the model. Raw artifacts contain the API payload; intermediate artifacts retain assembled items, metadata and
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

Sends five live requests sequentially, for 3, 4, 6, 8, and 10 target blocks.
The function schema and synthetic statement stay constant; the target list,
prompt size, and requested number of calls grow. This now measures function-call
completeness, not JSON response-schema complexity. It uses the
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

`createGeminiProvider` processes three target source blocks per request by
default, sequentially. Set `GEMINI_BATCH_SIZE` to a positive integer (maximum
12) to use a measured size for a particular model/account. Run the controlled
block-count diagnostic first; a successful probe is evidence for that request
shape only, not a universal Gemini limit. The default remains conservative.
Each request includes only target blocks and their heading/section signals.
The original JD remains local for evidence validation. Output must cover only those target IDs and evidence must
come from each target block. Non-target context must not generate extra records.

Every batch undergoes schema, coverage and evidence validation. Results are
assembled in source order; metadata conflicts retain candidates for human review.
Full-document coverage and evidence are checked after assembly, then
the existing semantic merge, normalization and final mapping continue. A failed
batch stops further requests and no new final job is written. Existing atomic
output behavior remains unchanged.

Logs identify `batch N/total`. Retry and timeout settings apply per request;
sequential batching increases latency and API usage (15 units require five
requests at the default size). Single-batch raw debug output remains the provider JSON. Multi-batch
raw debug output is `{ "batches": [{ "batch": 1, "blockIds": [...], "response":
"raw response text" }] }`, refreshed after each received response. It includes
an invalid received response before validation, but does not invent a response
for HTTP/network failures. Intermediate/final output is only returned after all
batches succeed.

The schema-count probe deliberately uses the unbatched request helper so it
continues to measure actual 3/4/6/8/10-block requests. The smoke test uses the
production batched provider. Offline batching coverage:
`node --test tests/gemini-batches.test.mjs`.

### One bounded batch correction

A received response that fails JSON/schema/accounting or evidence validation
gets at most two semantic correction requests. `GEMINI_MAX_CORRECTIONS` can
set a positive value up to three. When local block inspection can
identify a strict subset of invalid block IDs, the correction contains only
those blocks and already approved blocks are retained. Otherwise it contains
the same target batch. It
includes only the decoded prior response for those target blocks, validator
feedback, the original target source context and unchanged schema. Raw provider
payloads remain in debug artifacts and are never replayed to Gemini. The
correction asks for complete block results. Empty extracted blocks must receive source-backed records or an
explicit exclusion reason. Code may normalize an empty extracted block only for
an exact recognized standalone navigation/heading label outside a classified
section. Every such normalization logs an `empty_block_excluded` reason. Short
qualifications and marketing paragraphs are not automatically discarded.
The validated, normalized blocks are merged directly; raw payloads are not decoded again.

Each corrected response passes the same validations. If the final correction still fails, the run
stops before final output and before any later batch. HTTP, authentication,
and network failures do not trigger this path.
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

Detailed response/source logs require `JOB_PARSER_DEBUG=1` and use the supplied
logger. Normal progress and human-review warnings remain visible. Metadata
candidates and evidence remain in the intermediate/debug artifact and mapping
warnings; final legacy JSON carries the selected value. Coverage accounts for
blocks but does not prove that all qualifications within them were extracted.

## Bounded source and status recovery

Evidence quotes match literal source substrings with whitespace normalization.
They do not require token boundaries: scraped text such as
`Quality AssuranceRemote, Brazil` still contains the quote `Remote, Brazil`.
Extracted values retain word/symbol boundary checks in both their quote and the
original source. This prevents a shortened quote from legitimizing `Java` from
`JavaScript`, or `C` from `C++`. The geographic value `Brazil` can pass; a
work-arrangement label is still rejected as a location value.

After wire-shape validation, the adapter may restore capitalization-only value
differences using the matching source-backed quote. It keeps token boundaries
and does not stem words, translate, add text, change punctuation, or repair
fabricated quotes. Ordinary values, alternative options, and metadata values
are checked again afterward. Raw API artifacts are untouched.

An `excluded` block containing records may become `extracted` only if every
record passes the existing schema, classification, grounding, and metadata-role
checks. No records are dropped. Each change emits `block_status_corrected` with
the original reason and block ID. `unresolved` blocks, invalid records, and empty
substantive blocks still fail. Final alternative semantics and mapping validation
remain mandatory; these recovery steps do not establish semantic completeness.

Offline regressions: `node --test tests/job-grounding-recovery.test.mjs`.
# Qualification details in structured output

Block inspection now shares item-semantic checks with final mapping. Mapping
problems such as AND lists encoded as anyOf are returned to the existing single
correction attempt while the source block is still available. Invalid corrections
remain errors; no automatic truncation, omission or reinterpretation is applied.
Metadata duplicated as requirements and explicit company-stack descriptions are
checked conservatively. Candidate conflict handling is unchanged.

For unmarked parenthetical lists, feedback asks for the whole qualification,
not an inferred example/choice relationship. Work-arrangement grounding feedback
asks the model to retain hashtags and conditions verbatim; technology token
boundaries remain strict (Java is not extracted from JavaScript).

Before accepting a block, the provider checks simple parenthetical example lists
introduced by `such as`, `e.g.`, `for example`, `como` or `por exemplo` immediately
after the extracted qualification. Missing or partial `examples` produce
`missing_examples` feedback, with the missing spellings, through the existing
single correction attempt. Persistent omissions fail explicitly. The check does
not invent examples, normalize source spellings or convert them to alternatives.
It intentionally skips nested lists, complex prose, unrelated illustrations and
lists already retained in the value. It examines the returned quote; it cannot
prove that all relevant source content was quoted or extracted. This is not a
general recall guarantee. Test offline with
`node --test tests/job-example-coverage.test.mjs`.

The tool schema accepts optional ordinary-item `examples` records grounded in
the item's quote, and source-backed `metadata.workArrangement`. The prompt asks
for language levels as required/preferred requirements, retains illustrative
technologies without anyOf conversion, and checks benefits for work arrangement.
Local evidence validation checks each example; local schemas reject malformed
records. These checks establish grounding and structure, not semantic recall.
Live runs are still needed to measure omissions and classification quality.

## Large job descriptions

Preprocessing splits only oversized paragraph units at complete sentence
boundaries outside parentheses. It preserves original offsets and never splits
bullets or sentences merely to meet a size target. A sentence longer than the
target remains whole. This reduces unrelated requirements competing in one
provider block while retaining evidence grounding.

Batching is sequential. After an accepted batch, source-backed metadata is sent
as `CONFIRMED METADATA FROM EARLIER SOURCE BLOCKS` to later batches. The model
must not reintroduce company/title values or title variants as candidate
requirements. This is contextual guidance, not a replacement for local semantic
validation. Run the offline batch regression with
`node --test tests/gemini-batches.test.mjs`.
