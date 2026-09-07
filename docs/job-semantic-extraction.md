# Semantic extraction

`lib/job-parser/semantic-extract.mjs` adds the semantic stage after deterministic
preprocessing and extraction. It accepts a preprocessed document, deterministic
intermediate items, and an injected provider. The provider may be an LLM adapter
later, but this stage currently uses deterministic mocked providers in tests.

The provider receives only source text, sections, and unresolved units. Candidate
data, resumes, scores, and final job objects are outside this interface. Provider
output must conform to `schemas/job-parser.schema.json`.

Every semantic item and present metadata value must include an evidence quote that
occurs exactly in the original source text. Fabricated evidence is rejected.
Responsibilities remain separate from competencies, ambiguous classifications
remain ambiguous, and alternatives remain one `anyOf` item.

Validated semantic items are appended to deterministic items. Exact duplicate
objects are ignored; related values are not deduplicated. Semantic metadata fills
missing deterministic metadata, while conflicts fail explicitly. Inputs are never
modified, and no final job JSON is generated.

Run the offline tests with:

```sh
npm run test:semantic-extraction
npm run test:extraction
npm run test:parser-aliases
npm run test:schemas
npm run test:preprocess
```

This stage does not call an LLM, normalize aliases, map alternatives to legacy
arrays, inspect candidate data, or calculate scores.
