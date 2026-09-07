# Intermediate-to-job compatibility mapping

`lib/job-parser/map-to-job.mjs` maps a schema-valid intermediate extraction to
the legacy job shape consumed by `analyse.mjs`. It returns `{ valid, job, errors }`
and never mutates the extraction.

Company and title map directly. `employmentType` maps to the observed `type`
field and `sourceUrl` maps to `source.url`. Location has no established equivalent
for the legacy `remote` field, so it returns an explicit compatibility error.

Required and preferred items map to nested `requirements.required` and
`requirements.preferred`. Competencies map to `requirements.competencies`.
Responsibilities map to the existing `responsibilities` array and are never
converted into competencies.

Ambiguous items, unsupported classifications, missing company/title, and
unsupported metadata return explicit errors. Alternative groups return an
`unsupported_alternative` error because flat legacy arrays cannot preserve OR
semantics. They are never flattened into AND requirements.

Successful output is validated with the existing final job schema. Invalid or
incompatible mapping returns `job: null`, so unsupported content cannot reach a
caller as accepted final output.

Run the focused tests with:

```sh
npm run test:map-job
```
