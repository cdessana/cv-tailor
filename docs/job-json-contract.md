# Current Job JSON Contract

## Purpose

This document describes the repository behavior at commit `a9935d5`, before the
job-parser feature. It distinguishes the one observed job fixture from runtime
checks and accidental tolerance. It does not define a new schema.

## Current consumers

- [`scripts/analyse.mjs`](../scripts/analyse.mjs) parses the job directly with
  `JSON.parse`, matches its nested requirements against resume/evidence data,
  and writes analysis JSON.
- [`scripts/match.mjs`](../scripts/match.mjs) independently parses the same job
  shape and prints matches and scores. It is not called by the pipeline runner.
- [`scripts/run.mjs`](../scripts/run.mjs) parses the job, checks company/title
  slugs, establishes output paths, and invokes analysis followed by tailoring.
- [`scripts/tailor.mjs`](../scripts/tailor.mjs) consumes the resulting analysis,
  not the original job. Later rewrite, summary, and checking stages consume
  derived plans/resumes. They do not extract requirements from job prose.

## Canonical observed shape

[`data/jobs/flash-senior-backend.json`](../data/jobs/flash-senior-backend.json)
is the only tracked job fixture. The following is its observed structure, using
representative values and shortened arrays; it is not an enforced schema:

```json
{
  "title": "Engenheira de Software Sênior",
  "company": "Flash",
  "type": "CLT",
  "remote": "Remote",
  "source": {
    "platform": "Lever",
    "url": "https://example.com/job",
    "applicationUrl": "https://example.com/job/apply"
  },
  "description": "Senior software engineering role...",
  "responsibilities": ["Compartilhar conhecimento e boas práticas com o time"],
  "qualifications": ["Experiência com Node.js, React..."],
  "skills": [{ "name": "Backend", "keywords": ["Node.js", "REST APIs"] }],
  "requirements": {
    "required": ["Node.js"],
    "preferred": ["NestJS"],
    "competencies": ["Mentoring"]
  },
  "screening": [
    { "topic": "Node.js / NestJS", "type": "level" },
    {
      "topic": "Containers and orchestration",
      "keywords": ["Docker", "Kubernetes"],
      "type": "boolean"
    }
  ],
  "metadata": { "language": "pt-BR", "status": "active" }
}
```

## Field contract

Types below describe the observed model. “Required” describes current checks,
not a proposed validator. “Ignored” refers to the original job consumers above.

| Field | Observed type | Required | Consumer | Behavior if missing | Notes |
| --- | --- | --- | --- | --- | --- |
| `title` | string | Runner requires a nonempty slug | run, analyse, match | Runner rejects; direct analysis/match tolerate | Analysis metadata, console heading, analysis filename |
| `company` | string | Runner requires a nonempty slug | run, analyse, match | Runner rejects; direct analysis/match tolerate | Also determines pipeline output directory |
| `source` | object | No | analyse | Written as `null` | Passed through without nested validation |
| `source.platform` | string | No | No nested consumer | No default | Observed metadata only |
| `source.url` | string | No | No nested consumer | No default | No URL validation |
| `source.applicationUrl` | string | No | No nested consumer | No default | No URL validation |
| `requirements` | object | No | analyse, match | All categories empty | Nested categories only |
| `requirements.required` | string[] | No | analyse, match | `[]` | Category `required` |
| `requirements.preferred` | string[] | No | analyse, match | `[]` | Category `preferred` |
| `requirements.competencies` | string[] | No | analyse, match | `[]` | Analysis category is singular `competency` |
| `type` | string | No | Ignored | No effect | `CLT` is an example, not an enum |
| `remote` | string | No | Ignored | No effect | Not a boolean in the fixture |
| `description` | string | No | Ignored | No effect | Not scanned for requirements |
| `responsibilities` | string[] | No | Ignored | No effect | Not scored |
| `qualifications` | string[] | No | Ignored | No effect | Not scanned for requirements |
| `skills` | object[] | No | Ignored | No effect | Entries have `name: string`, `keywords: string[]`; these are job skills, distinct from consumed resume skills |
| `screening` | object[] | No | Ignored | No effect | Entries have `topic`, `type`, and sometimes `keywords`; observed types are `level` and `boolean` |
| `metadata` | object | No | Ignored | No effect | Observed `language: string` and `status: string`; no enforced enums |

## Requirements contract

Analysis constructs entries from these expressions:

```js
job.requirements?.required ?? [];
job.requirements?.preferred ?? [];
job.requirements?.competencies ?? [];
```

Each result is mapped to `{ term, category }`. Match uses
`const requirements = job.requirements ?? {}` followed by the same category
fallbacks. Top-level `required`, `preferred`, or `competencies` are ignored.
There is no extraction from `description`, `skills`, or `qualifications`.

Every array entry is evaluated independently. Input order is retained within
categories before analysis groups results by status. Duplicate terms are not
removed, including duplicates within one category, so they can change scores.
No per-entry weights, evidence spans, or alternative groups are interpreted.

Both matchers award exact/equivalent matches 1 point, related matches 0.5, and
missing matches 0. Category percentages are rounded; an empty category scores
0. Analysis reports `coreRequirements`, `preferred`, and
`engineeringCompetencies`. Strong and related entries feed recommended emphasis;
missing entries feed `doNotAdd`. Tailoring subsequently weights the categories
`required: 5`, `preferred: 3`, and `competency: 2`. Moving text between categories
therefore changes downstream behavior.

## Source metadata contract

Analysis writes `source: job.source ?? null` inside `analysis.job`. Any non-null
JSON value, including a string, is passed through unchanged. Missing nested
properties are not populated. Match and run do not inspect source. Tailoring
copies `analysis.job` into its plan/report; this preserves source metadata but
does not make its nested shape a validated contract.

## Responsibilities status

The fixture persists responsibilities, but neither matcher reads them. They do
not directly affect scores, recommended emphasis, or tailoring. They are not
copied into `analysis.job`. Persisting them in future job output is compatible
with the current readers; converting them to competencies would change scoring
and requires a separate decision.

## Alias matching contract

[`data/aliases.json`](../data/aliases.json) maps lookup keys to arrays of matching
terms. For example, `"Node.js": ["Node.js", "NodeJS", "Node"]`.

Lookup uses `aliases[term]`: keys are case-sensitive, and there is no reverse
search through alias values. `Node.js` expands to its configured candidates;
`node.js` and `NodeJS` have no corresponding keys in the current file. They can
still match identical normalized resume terms, but do not receive the `Node.js`
key's expansion. The original requirement term is retained in output.

The candidate builders differ:

```js
// analyse.mjs (also tailor.mjs)
return [term, ...(aliases[term] ?? [])];

// match.mjs
return aliases[term] ?? [term];
```

Analysis always includes the original term. Match uses only the configured array
when a key exists, although its exact skill check separately checks the original
term. This can affect work-evidence matching if an alias array omits its key.
Every current alias array includes its key, masking that particular difference.

Both matchers convert comparison values with `String(value)`, lowercase, apply
NFKD normalization, replace characters other than letters, numbers, `+`, `#`,
and `.` with spaces, and collapse/trim whitespace. Analysis additionally strips
combining marks in U+0300–U+036F before replacement; match does not. Their accent
handling is therefore not identical. Skill comparisons use normalized equality;
prose evidence uses a space-delimited phrase substring, not fuzzy matching or
semantic inference.

The dictionary mixes lexical variants (`NodeJS`, `Mongo DB`, `DDD`) with related
concepts: `RPC` includes `gRPC`, `CI/CD` includes `GitHub Actions` and `GitLab CI`,
`Scalable Systems` includes `Distributed Systems`, and `Technical Leadership`
includes `Architecture Discussions`. These entries expand matching evidence;
they do not establish safe equivalence for rewriting source job text. Treat this
as a matching dictionary, not a ready-made parser normalization dictionary.

## Behavior for missing fields

For direct analysis/match, `{}`, `{"requirements": {}}`, and
`{"requirements": null}` all produce empty categories. Missing or null individual
categories also become empty arrays.

Missing company/title appear as `undefined` in console output. Direct analysis
uses `String(value)` in its slug function, yielding filename components such as
`undefined` or `null`; undefined metadata properties are omitted by
`JSON.stringify`, whereas explicit nulls remain null.

The runner is stricter: its `slug(value = "")` defaults a missing value to an
empty string, then explicitly rejects empty company/title slugs with
`Job JSON must contain a valid company.` or `Job JSON must contain a valid title.`
Strings containing only punctuation, whitespace, or characters that leave no
ASCII letters/digits after normalization also fail this check. It is not a
comprehensive string/schema validator.

## Behavior for unknown fields

Additional properties are not rejected. Unconsumed top-level fields and unknown
requirement properties have no matching effect. Analysis builds a new job
metadata object containing only title, company, and source: tolerating a field
in the input does not mean propagating it to downstream artifacts. Unknown
properties inside a provided source value survive its pass-through.

## Behavior for invalid types

- Invalid JSON fails at `JSON.parse`; unreadable files fail at file loading.
- A null root fails on property access. Other JSON primitives and arrays can
  slip through direct readers as jobs with absent fields; run rejects their
  missing company/title. No reader validates that the root is a plain object.
- A non-null category that is a string, number, boolean, or object fails when
  `.map()` is called. There is no explicit job schema error.
- An incorrectly typed `requirements` container such as a string, number,
  boolean, or array can silently yield empty categories because its named
  category properties are absent.
- Requirement item types are not checked. For example, `[123]` reaches matching
  through string coercion while its output `term` stays numeric. Empty strings
  and duplicate entries are not rejected. Such tolerance is not a supported
  structured requirement model; unusual values can fail later operations.
- Non-string company/title values are stringified by direct analysis, but null,
  numbers, booleans, arrays, and objects fail in the runner's `.normalize()` call.
  Direct match interpolates them into its console heading.
- Unconsumed fields have no type checks; source is passed through as described
  above.

There is also a filename compatibility edge case: run uses NFD for slugging,
while analysis uses NFKD. A string containing compatibility characters such as
fullwidth Latin letters can produce different slugs, so run can fail to find the
analysis file even after accepting company/title. This remains unchanged.

## Alternative requirements limitation

The flat arrays have no OR semantics. `["AWS", "GCP", "Azure"]` creates three
separately scored entries, not one satisfied-by-any-cloud requirement. A single
`"AWS, GCP, or Azure"` string is treated as a literal matching term, not parsed
as alternatives. Structured objects likewise have no defined interpretation.
A future parser's projection of explicit alternatives is unresolved; silently
splitting alternatives changes the scoring denominator and coverage expectations.

## Known schema limitations and handoff corrections

Repository inspection confirms the nested requirement shape and the ignored
fixture fields, with these additions to the handoff:

- The raw job also has consumers in run and match. Company/title are checked
  through slug generation by run; the handoff's missing-field tolerance applies
  to direct analysis/match, not the pipeline entry point.
- Validation tooling already exists. [`scripts/validate.mjs`](../scripts/validate.mjs)
  uses AJV and ajv-formats with the remote JSON Resume schema for the base resume.
  [`scripts/summary.mjs`](../scripts/summary.mjs) uses Zod for generated summary
  JSON. Both toolsets are declared in [`package.json`](../package.json).
  Neither validates job JSON. ATS and final checks inspect resumes/plans, not
  the raw job contract. No reusable job schema or job validation utility was
  found in the tracked repository.
- Alias candidate construction, accent normalization, and runner/analysis slug
  normalization have the differences documented above.
- There is only one tracked job fixture, so its optional metadata structure,
  screening fields, and example values cannot establish required fields/enums.

## Implications for job-parser and open decisions

For compatibility, generated jobs should use company/title strings usable by
both slug functions and nested arrays of requirement strings. Preserve category
placement deliberately, retain useful metadata in the job artifact, and account
for case-sensitive alias expansion. The current consumers neither validate
source evidence nor provide source-grounded canonicalization.

Future work must decide strict required fields and nullability, unknown-property
policy, safe lexical normalization versus related-term matching, and how to
represent/project explicit alternatives. Responsibilities can remain persisted
without entering scoring. Schema design, parser implementation, alias refactoring,
validation changes, and responsibility scoring are outside this documentation
subissue.

## Parser location extension

Final jobs may include an optional `location` string containing at least one
non-whitespace character. The parser preserves validated `metadata.location.value`
exactly and omits the field when absent. Null, empty, whitespace-only, and
non-string values are rejected by the final schema. Multiple locations remain
one source-supported string. This additive field is ignored by `analyse.mjs`;
existing manually authored jobs need no changes.

Only explicitly stated job locations should be extracted, not unrelated corporate
footer addresses. Existing evidence validation checks textual support; it cannot
independently establish an address's semantic role. Geographic normalization,
remote/hybrid classification, and candidate filtering remain out of scope.
