# Intermediate-to-job compatibility mapping

`lib/job-parser/map-to-job.mjs` maps a schema-valid intermediate extraction to
the legacy job shape consumed by `analyse.mjs`. It returns `{ valid, job, errors, warnings }`
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
skill, requirement, or competency items containing unresolved `or` or `ou` fail
with `unstructured_alternative`. Explicit parenthetical illustrations retained in
the value, numeric thresholds and the bounded `conhecimento ou interesse em`
modifier are not technology choices. A real choice elsewhere in the same value
still requires an alternative representation.

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
more complex example relationships still require semantic
review. A failed mapping returns no accepted partial job.

Non-parenthetical example-only groups also fail instead of truncating a quote
into a replacement requirement. Commas and co-occurring technologies are not
proof of an OR relationship.

Distinct source-backed metadata candidates retain the existing primary selection.
Mapping emits `ambiguous_metadata` with `requiresHumanValidation: true`, the
selected value/evidence, and all candidates. These warnings do not fail the parse.
Evidence validation checks every candidate. Candidate details remain available
in intermediate output and warnings; final job fields contain the selected values.

Preferred domain or team-environment experience should be extracted as a
`requirement` with `preferred` classification, so it stays in the preferred
array. True behavioral competencies remain distinct. The existing legacy
competencies array still cannot retain required/preferred classification; this
change does not redesign that final contract.

Evidence validation rejects obvious work-arrangement-only employment types
(remote, hybrid, onsite and Portuguese equivalents) and required extractions
supported solely by a recognized Tech Stack section. These are bounded checks,
not general language classification. Supported location stays in `location`;
work arrangement uses the source-backed intermediate `workArrangement` record
and existing final `remote` text field described below.

Merging only deduplicates otherwise equivalent items when their normalized
quotes contain one another. It retains the fuller quote and keeps distinct
conditions as separate records rather than silently erasing their evidence.
# Preserving qualification details

Ordinary skill, requirement and competency items may carry a nonempty `examples`
array of `{ "value": "..." }` records. Each value is grounded in the parent
item's evidence. These are illustrations, not additional mandatory requirements
or exhaustive alternatives. Missing examples are omitted, not null or empty.
Examples are not supported on responsibilities, ambiguous items or alternatives.

The final optional `requirementExamples` collection contains `classification`,
`requirement` and `values`. Here `classification` identifies the destination
array (`required`, `preferred` or `competencies`); `requirement` is its final
normalized string. The mapper builds this link together with the requirement.
Existing requirement arrays remain strings. `analyse.mjs` does not score the
example collection. Approved aliases can normalize example spellings; unknown
values remain unchanged, and original extraction/evidence remains available.

Intermediate `metadata.workArrangement` uses the existing source-backed metadata
record contract and maps to the existing final text field `remote`. It preserves
source wording such as `work 100% remotely`, not a normalized enum. Geography
remains `location`. Benefits sections can contain work arrangement metadata.
Conflicting candidates retain the current primary-selection behavior and human
validation warning. Flexible schedules are not extracted as a separate field.

Language proficiency should be extracted as a requirement with its source
required/preferred classification, rather than a behavioral competency. This is
a semantic classification instruction; schema validation alone cannot guarantee
that the model classified a sentence correctly.

Duplicate removal remains limited to equivalent values and classifications with
containing evidence quotes. It preserves examples from both records. Similar
phrases with different duration, scope or conditions are not automatically
collapsed. This may leave summary/detail overlaps rather than erase qualifiers.

Run the offline detail-preservation regression with:
`node --test tests/job-detail-preservation.test.mjs`.

## Shared semantic gate

`validate-item-semantics.mjs` returns errors without rewriting records. Both the
Gemini block inspector (before its single correction attempt is exhausted) and
the final mapper call it. It rejects conjunctions represented as anyOf, choices
whose signal does not connect the option spans, illustrative-only groups,
identification metadata repeated as requirements, and narrowly recognized stack
context promoted to qualifications. It preserves source-backed metadata candidate
selection and human-review warnings.

Simple unmarked parenthetical lists attached to a shortened value produce
`missing_qualification_details`: preserve the full qualification instead of
assuming the list is optional examples. For example, keep `(OAuth, JWT)` and
`(Terraform, Ansible)` in the ordinary value. This rule is intentionally bounded
and does not interpret arbitrary prose or nested parentheses. Schema, grounding
and these checks do not prove semantic completeness.

Offline real-text regression cases: `node --test tests/job-semantic-relations.test.mjs`.
Tests cover correction and mapping using small C6/Arco excerpts, not generated
personal artifacts. No matching/scoring behavior changes.

## Narrow redundancy shadowing

Before final mapping, a required/preferred ordinary item is omitted only when an
alternative with the same classification and exact normalized evidence retains
that item's value as a leading prefix and contains its options later in the same
quote. This preserves `Experience in production with Go or Kotlin` as one
alternative instead of also emitting `Experience in production` as a separate
requirement. The mapper emits a `shadowed_item` warning. Similar wording,
different evidence, durations, scopes and conditions remain distinct. This is a
bounded compatibility cleanup, not semantic deduplication or matching change.
