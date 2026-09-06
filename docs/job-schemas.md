# Job parser schemas

These schemas define structural boundaries for future parser work. They are not
wired into the pipeline. The existing consumers and job fixture are unchanged.
See [the current runtime contract](job-json-contract.md) for observed behavior.

- [Intermediate extraction schema](../schemas/job-parser.schema.json)
- [Final job schema](../schemas/job.schema.json)

## Validation

Run the focused tests with the project's installed dependencies:

```sh
npm run test:schemas
```

The tests use Node's built-in test runner and the existing AJV dependency. Both
schemas declare Draft-07, supported by AJV's default implementation, and use
only internal references. Compilation and validation require no network access.
AJV runs in strict mode with coercion, additional-property removal, and defaults
disabled. Tests assert that validation leaves both valid and invalid data
unchanged. No new validation library is needed.

## Intermediate model

The root requires `items`, an array that may be empty. `metadata` may be omitted
or `{}` when nothing was extracted. All present metadata entries require `value`
and `evidence`; `sourceSection` is optional. Supported metadata keys are
`company`, `title`, `location`, `employmentType`, and `sourceUrl`.

Every string must contain a non-whitespace character. No field accepts null,
no defaults are inserted, and every object rejects additional properties.
Omit unknown metadata and unavailable source sections rather than inserting
nulls or placeholder text. Values are not restricted to alias dictionary keys.

Every item requires `type`, `kind`, `classification`, and `evidence`.
`type: "item"` requires a single `value`. `type: "alternative"` requires
`operator: "anyOf"` and a `values` array with at least two distinct strings.
Neither form accepts the other's value field. `sourceSection` is optional on
both forms.

Kinds describe semantic roles; classifications describe requirement strength:

| Kind             | Meaning                                                | Allowed classifications              |
| ---------------- | ------------------------------------------------------ | ------------------------------------ |
| `skill`          | A named skill or technology                            | `required`, `preferred`, `ambiguous` |
| `requirement`    | Other qualifications, such as experience or education  | `required`, `preferred`, `ambiguous` |
| `competency`     | An explicitly stated capability, such as communication | `required`, `preferred`, `ambiguous` |
| `responsibility` | An activity the role will perform                      | `not-applicable`                     |
| `ambiguous`      | The statement's semantic role is unresolved            | `ambiguous`                          |

`not-applicable` avoids pretending that a responsibility has required/preferred
qualification strength. A clear skill or competency with unclear strength keeps
its kind and uses classification `ambiguous`. If even the semantic role is
unclear, use kind `ambiguous`. These combinations apply to both single items and
alternative groups. The schema checks the labels' compatibility, not whether
those labels correctly describe the source.

```json
{
  "metadata": {
    "company": {
      "value": "Example",
      "evidence": { "quote": "Join Example" }
    }
  },
  "items": [
    {
      "type": "item",
      "kind": "responsibility",
      "classification": "not-applicable",
      "value": "Mentor engineers",
      "evidence": { "quote": "You will mentor engineers" },
      "sourceSection": "Your role"
    },
    {
      "type": "alternative",
      "operator": "anyOf",
      "kind": "skill",
      "classification": "required",
      "values": ["AWS", "GCP", "Azure"],
      "evidence": {
        "quote": "Experience with AWS, GCP, or Azure is required"
      }
    }
  ]
}
```

An alternative group is one statement satisfied by any of its options. Its kind,
classification, evidence, and optional section apply to the whole group. The
quote must eventually support all listed options and their relationship. The
schema rejects exact duplicate strings, but does not normalize or compare
semantic equivalents. Nested boolean expressions and per-option classifications
are not introduced here.

Evidence is a strict object containing only a nonblank `quote`. Quotes provide
source excerpts without requiring an offset convention before preprocessing
exists. The schema does not validate quote occurrence, whether an extraction is
supported by its quote, or the accuracy of a source-section label. Those checks
belong to later source-grounding work; structurally valid fabricated evidence can
still pass this schema.

## Final output model

The final schema requires only nonblank string `company` and `title` fields.
Every other field is optional, preserving omission where current consumers have
fallbacks. No fields accept null and no defaults are applied.

| Field                                               | Structure when present                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `company`, `title`, `type`, `remote`, `description` | Nonblank string                                                                          |
| `source`                                            | Object with optional nonblank `platform`, `url`, `applicationUrl` strings                |
| `requirements`                                      | Object with optional `required`, `preferred`, `competencies` string arrays               |
| `responsibilities`, `qualifications`                | String arrays                                                                            |
| `skills`                                            | Array of objects requiring nonblank `name` and a `keywords` string array                 |
| `screening`                                         | Array of objects requiring nonblank `topic` and `type`; optional `keywords` string array |
| `metadata`                                          | Object with optional nonblank `language` and `status` strings                            |

All string-array items must be nonblank strings. Arrays may be empty; duplicate
final requirement strings remain permitted because the current consumer scores
them independently. Optional `source`, `requirements`, and `metadata` containers
may be empty objects. Every object is closed to additional properties, including
skill groups and screening entries. Values such as employment type, screening
type, language, and status are not closed enums inferred from the single fixture.
URL fields are nonblank strings without a format assertion, preserving the
observed string contract without introducing URL policy or ingestion behavior.

The final schema accepts the existing fixture unchanged, but deliberately
rejects some values the runtime tolerates: missing company/title, null fields,
non-string metadata, malformed requirement containers/items, blank text, and
unknown properties. It rejects old top-level requirement arrays and confidence
fields. These restrictions define valid output; they do not modify the runtime
or retroactively validate existing inputs.

## Deferred boundaries

- Missing company/title can pass intermediate validation but cannot pass final
  validation. Later work must define explicit failure or externally supplied
  metadata, without inventing values.
- Intermediate `employmentType`, `location`, and `sourceUrl` are extraction
  concepts, not new final fields. Their compatibility mapping is not implemented.
- Responsibilities remain a separate final array. Neither schema converts them
  into competencies or makes them participate in scoring.
- The final flat arrays have no OR semantics. Projecting intermediate alternatives
  remains unresolved; neither flattening them, discarding them, nor joining them
  into a literal string is an implemented mapping policy. Public boolean-group
  support requires separate work.
- Alias normalization and evidence validation are not implemented. The matching
  dictionary's related terms are not assumed safe for canonicalization.
- Nonblank company/title strings do not guarantee usable or identical filenames.
  The runner and analysis have different slug normalization, and punctuation-only
  or some non-ASCII strings can fail downstream. Schema success does not guarantee
  pipeline success; slug behavior remains unchanged.

The tests exercise structural acceptance/rejection only. They do not run an LLM,
perform extraction, invoke the pipeline, or prove semantic grounding.
