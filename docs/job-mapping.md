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

Model-generated groups without explicit choice evidence now fail with
`invalid_alternative` instead of being dropped with a warning. Parenthetical
example lists introduced by `such as`, `e.g.`, `for example`, `como`, or
`por exemplo` also fail when all group options are inside that list, even when
it contains OR. The provider should extract the broader qualification as an
ordinary item, retaining the complete evidence. Mapping does not invent a
replacement value. This bounded check is not a general natural-language parser;
non-parenthetical or more complex example relationships still require semantic
review. A failed mapping returns no accepted partial job.

Preferred domain or team-environment experience should be extracted as a
`requirement` with `preferred` classification, so it stays in the preferred
array. True behavioral competencies remain distinct. The existing legacy
competencies array still cannot retain required/preferred classification; this
change does not redesign that final contract.

Evidence validation rejects obvious work-arrangement-only employment types
(remote, hybrid, onsite and Portuguese equivalents) and required extractions
supported solely by a recognized Tech Stack section. These are bounded checks,
not general language classification. Supported location stays in `location`;
no new work-arrangement field is introduced.

Merging only deduplicates otherwise equivalent items when their normalized
quotes contain one another. It retains the fuller quote and keeps distinct
conditions as separate records rather than silently erasing their evidence.
