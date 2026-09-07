# Intermediate-to-job compatibility mapping

`lib/job-parser/map-to-job.mjs` maps a schema-valid intermediate extraction to
the legacy job shape consumed by `analyse.mjs`. It returns `{ valid, job, errors }`
and never mutates the extraction.

Company and title map directly. `employmentType` maps to the observed `type`
field and `sourceUrl` maps to `source.url`. Validated `location.value` maps directly
to the optional final `location` string, preserving its wording. Absent location
is omitted. Multiple locations remain one string; no geographic normalization
or remote/hybrid classification is performed. Evidence validation must precede
mapping, as with other extracted metadata.

Required and preferred items map to nested `requirements.required` and
`requirements.preferred`. Competencies map to `requirements.competencies`.
Responsibilities map to the existing `responsibilities` array and are never
converted into competencies.

Ambiguous items, unsupported classifications, missing company/title, and
unsupported metadata return explicit errors. Required and preferred alternative groups map to `alternativeRequirements`.
Their original evidence wording is retained as `context` to preserve shared
phrasing. Ambiguous or responsibility alternatives remain unsupported. Plain
skill, requirement, or competency items containing standalone `or` or `ou` fail
with `unstructured_alternative`; this conservative check can require refinement
for non-alternative uses of those words.

Successful output is validated with the existing final job schema. Invalid or
incompatible mapping returns `job: null`, so unsupported content cannot reach a
caller as accepted final output.

Run the focused tests with:

```sh
npm run test:map-job
```
