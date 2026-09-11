# Job parser CLI

`node scripts/job-parser.mjs` orchestrates preprocessing, deterministic
extraction, optional semantic extraction, normalization, compatibility mapping,
final validation, and atomic output writing.

```sh
node scripts/job-parser.mjs job-description.txt
node scripts/job-parser.mjs --input job-description.txt --output data/jobs/example.json
node scripts/job-parser.mjs job-description.txt --semantic-provider ollama
```

For troubleshooting semantic output, set `JOB_PARSER_DEBUG=1`. The CLI then
captures the schema- and evidence-validated intermediate extraction to
`<output>.intermediate.json` before compatibility mapping. If semantic schema or
evidence validation fails, inspect the raw provider response instead; the
validated intermediate artifact is not written. Treat it as local diagnostic
output; it is never written during normal runs. The raw model text is
also captured as `<output>.provider-response.json` before JSON/schema validation,
so malformed semantic responses can be inspected too. Effective provider and
model metadata is written to `<output>.provider.json`; it is never added to the
canonical job JSON.

Positional input is equivalent to `--input`. Without `--output`, the CLI writes
`data/jobs/<input-basename>.json`. When unresolved content exists, the CLI selects
the semantic provider in this order: `--semantic-provider`,
`JOB_PARSER_PROVIDER`, `jobParser.semanticProvider` in the config file, then the
`none` default. Supported values are `gemini`, `ollama`, and `none`. The last
option disables network/model extraction and fails rather than dropping
unresolved content. Gemini or Ollama must be explicitly selected before the job
description can be sent to a semantic provider. Programmatic callers can still
inject a provider through `runJobParser`.

Supported LinkedIn archive text receives additional deterministic handling:
header metadata is preserved, short `SKILLS & KEYWORDS` bullets remain
unclassified skills, and archive-only separators, repeated metadata, navigation
messages, and provenance footers are excluded with explicit coverage reasons.
Only the remaining unresolved source blocks are sent to the selected semantic
provider.

Output is written only after all stages pass. It is first written to a temporary
file in the destination directory and renamed into place atomically. Input,
semantic, mapping, and output failures return a non-zero process exit code and do
not create a newly accepted partial job file.

Run the offline integration tests with:

```sh
npm run test:job-parser
npm run test:job-parser-providers
```
