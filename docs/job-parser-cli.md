# Job parser CLI

`node scripts/job-parser.mjs` orchestrates preprocessing, deterministic
extraction, optional semantic extraction, normalization, compatibility mapping,
final validation, and atomic output writing.

```sh
node scripts/job-parser.mjs job-description.txt
node scripts/job-parser.mjs --input job-description.txt --output data/jobs/example.json
```

Positional input is equivalent to `--input`. Without `--output`, the CLI writes
`data/jobs/<input-basename>.json`. The CLI currently has no live semantic provider;
fully deterministic descriptions with explicit metadata can succeed without one.
When unresolved content exists it exits with `SEMANTIC_ERROR` rather than dropping
content. Programmatic callers can inject a provider through `runJobParser`.

Output is written only after all stages pass. It is first written to a temporary
file in the destination directory and renamed into place atomically. Input,
semantic, mapping, and output failures return a non-zero process exit code and do
not create a newly accepted partial job file.

Run the offline integration tests with:

```sh
npm run test:job-parser
```
