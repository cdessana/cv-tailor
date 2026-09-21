# Semantic extraction

`lib/job-parser/semantic-extract.mjs` adds the semantic stage after deterministic
preprocessing and extraction. It accepts a preprocessed document, deterministic
intermediate items, and an injected provider. The provider may be an LLM adapter
later, but this stage currently uses deterministic mocked providers in tests.

The provider receives only source text, sections, and unresolved units. Candidate
data, resumes, scores, and final job objects are outside this interface. Default
providers return narrow source-ID decisions; the parser derives evidence,
source-unit references, section context, classification coverage, and canonical
records locally. Legacy full-extraction responses must conform to
`schemas/job-parser.schema.json`.

For legacy responses, every semantic item and present metadata value must include
an evidence quote that occurs in the original source text. Exact matching is
attempted first, followed by matching with normalized whitespace. Approved parser
aliases may support a canonical value such as `Kubernetes` when the source
explicitly says `k8s`; related matching aliases are never used. Fabricated
evidence is rejected with structured validation errors before merging.
Responsibilities remain separate from competencies, ambiguous classifications
remain ambiguous, and alternatives remain one `anyOf` item.

Validated semantic items are appended to deterministic items. Exact duplicate
objects are ignored; related values are not deduplicated. Semantic metadata fills
missing deterministic metadata, while conflicts fail explicitly. Inputs are never
modified, and no final job JSON is generated.

Run the offline tests with:

```sh
npm run test:evidence
npm run test:semantic-extraction
npm run test:extraction
npm run test:parser-aliases
npm run test:schemas
npm run test:preprocess
```

This stage does not call an LLM, normalize aliases, map alternatives to legacy
arrays, inspect candidate data, or calculate scores.

## Narrow enrichment decisions

Default providers return `decisions` rather than the legacy full extraction
object. Each decision contains a `unitId` and an action: `exclude`,
`requirement`, `responsibility`, `alternative`, or `metadata`.
Alternatives carry exact source-backed `values`; metadata carries
`metadataKey` and an exact `value`. The parser derives evidence quotes,
source-unit references, source section, and coverage locally. A requirement
under an explicit required or preferred heading retains that classification; a
source-backed qualification in neutral or Activities prose becomes a generic
final `qualifications` entry instead of inventing required/preferred strength.
The existing full extraction response is kept as a compatibility path for
explicit `decisionMode: false` configurations and older checkpoints. New
configuration defaults to narrow decision mode.

The migration boundary is intentionally in `semantic-extract.mjs`: switching an
adapter to the decision contract does not change source-evidence validation,
aliases, alternative validation, or downstream consumers. Gemini and Ollama use
the decision contract by default; their legacy full-extraction path remains
available only when decision mode is disabled.
