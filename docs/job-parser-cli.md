# Job parser CLI

`node scripts/job-parser.mjs` orchestrates preprocessing, deterministic
extraction, optional semantic extraction, normalization, compatibility mapping,
final validation, and atomic output writing.

```sh
node scripts/job-parser.mjs job-description.txt
node scripts/job-parser.mjs --input job-description.txt --output data/jobs/example.json
```

For troubleshooting semantic output, set `JOB_PARSER_DEBUG=1`. The CLI then
captures the schema- and evidence-validated intermediate extraction to
`<output>.intermediate.json` before compatibility mapping. If semantic schema or
evidence validation fails, inspect the raw provider response instead; the
validated intermediate artifact is not written. Treat it as local diagnostic
output; it is never written during normal runs. The raw model text is
also captured as `<output>.provider-response.json` before JSON/schema validation,
so malformed semantic responses can be inspected too.

Positional input is equivalent to `--input`. Without `--output`, the CLI writes
`data/jobs/<input-basename>.json`. When unresolved content exists, the CLI uses
Gemini when `GEMINI_API_KEY` is configured; otherwise it exits with
`SEMANTIC_ERROR` rather than dropping content. Programmatic callers can inject a
provider through `runJobParser`.

Output is written only after all stages pass. It is first written to a temporary
file in the destination directory and renamed into place atomically. Input,
semantic, mapping, and output failures return a non-zero process exit code and do
not create a newly accepted partial job file.

Run the offline integration tests with:

```sh
npm run test:job-parser
```
