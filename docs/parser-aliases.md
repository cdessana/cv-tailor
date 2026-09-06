# Safe parser aliases

[Parser aliases](../data/parser-aliases.json) are reviewed lexical spellings for
future normalization of already extracted values. They are separate from
[matching aliases](../data/aliases.json), which expand candidate evidence using
related concepts. Matching data and consumers remain unchanged.

This supplies the prerequisite for deterministic extraction and normalization;
that later stage must use the parser dictionary instead of directly reversing
the matching dictionary. No extraction, runtime job-item normalization, or
pipeline integration is implemented here.

## Review of existing relationships

Every existing matching key is registered as a canonical spelling. Every matching
array repeats its own key: **all of those identity relationships are approved**
and represented implicitly, not repeated in parser alias arrays. An empty array
therefore registers only the canonical spelling for future case normalization.

The table covers every other value in the current matching dictionary. Approved
values are stored as aliases; all excluded values are omitted. Decisions concern
context-independent lexical equivalence, not usefulness for candidate matching.

| Canonical key               | Approved non-identity values                                                                          | Excluded values and rationale                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REST APIs`                 | `RESTful APIs`, `REST API`: equivalent REST API naming and singular/plural terminology                | None                                                                                                                                                                                                                  |
| `GCP`                       | `Google Cloud Platform`, `Google Cloud Platform (GCP)`: expanded platform name, with optional acronym | `Google Cloud`: potentially broader branding; exclude without context                                                                                                                                                 |
| `RPC`                       | None                                                                                                  | `gRPC`: specific technology, not interchangeable with the broader RPC concept                                                                                                                                         |
| `CI/CD`                     | None                                                                                                  | `Continuous Integration`, `Continuous Delivery`: individual parts of the combined concept; `GitLab CI`, `GitHub Actions`: products rather than equivalent names for the practice                                      |
| `Mentoring`                 | None                                                                                                  | `Mentor`, `Mentored`: role/verb forms that require contextual interpretation; `Technical Coaching`: related activity, not assured equivalence                                                                         |
| `Event-Driven Architecture` | None                                                                                                  | `Event-Driven`, `Event Driven`: adjectives with unspecified subject; `Asynchronous Messaging`, `Pub/Sub`, `Google Cloud Pub/Sub`: related mechanisms or products, not equivalent architecture names                   |
| `Scalable Systems`          | None                                                                                                  | `Scalable Backend`, `Scalable Backend Services`: narrower subjects; `Scalability`: property rather than systems; `Distributed Systems`: related architecture concept; `Enterprise-Scale`: ambiguous scale description |
| `Automated Testing`         | `Test Automation`: equivalent testing-practice terminology                                            | `Unit Testing`, `Unit Tests`, `Integration Testing`, `Automated Test Cases`: specific test types or artifacts rather than equivalent names for the overall practice                                                   |
| `Technical Leadership`      | None                                                                                                  | `Technical Lead`: role rather than capability; `Led Technical Discussions`, `Architecture Discussions`: activities/evidence that do not establish equivalent meaning                                                  |
| `Performance Metrics`       | None                                                                                                  | `Performance`: broader concern; `Page Loading Time`, `Application Responsiveness`: specific measurements/qualities; `Quality KPIs`: related metrics with a different scope                                            |
| `Reliability`               | None                                                                                                  | `Reliable`: adjective requiring its subject/context; `Quality Gates`, `Quality Regressions`: related quality controls/outcomes                                                                                        |
| `Domain-Driven Design`      | `DDD`: approved design acronym in the job-domain vocabulary                                           | None                                                                                                                                                                                                                  |
| `Clean Architecture`        | None                                                                                                  | None; canonical identity only                                                                                                                                                                                         |
| `Node.js`                   | `NodeJS`: spelling variant                                                                            | `Node`: ambiguous standalone word                                                                                                                                                                                     |
| `MongoDB`                   | `Mongo DB`: spacing variant                                                                           | None                                                                                                                                                                                                                  |

Two additions are explicitly required by the next issue and were not present in
the matching dictionary:

| Canonical key | Approved alias | Rationale                                         |
| ------------- | -------------- | ------------------------------------------------- |
| `Kubernetes`  | `k8s`          | Established abbreviation of the same technology   |
| `PostgreSQL`  | `postgres`     | Common short name of the same database technology |

The approved dictionary is intentionally small. Excluding a relationship leaves
the extracted concept available under its original spelling; it does not remove
it from matching or prohibit extraction. Uncertain relationships are excluded.
Approval of an acronym here is a controlled vocabulary decision, not proof that
an arbitrary occurrence in prose refers to that technology or concept.

## Storage and future lookup contract

Canonical names are dynamic JSON property names with arrays of alias strings.
Canonical spelling implicitly participates in lookup, so it must not be repeated
in its own alias array. Empty alias arrays and an empty dictionary are valid.
Every stored name must be nonblank, with only single ASCII spaces between tokens
and no leading/trailing whitespace. Tabs, line breaks, and nonbreaking spaces in
stored entries are rejected rather than repaired.

The comparison key trims surrounding whitespace, collapses whitespace sequences
to a single ASCII space, and applies JavaScript's locale-independent
`toLowerCase()`. It does not strip punctuation or accents, stem words, apply
Unicode compatibility normalization, or infer context. Strict stored formatting
and permissive comparison whitespace handling are deliberate: stored data stays
consistent while extracted values may contain formatting variations.

Future normalization must compare **complete extracted values** against canonical
names and aliases. It must return the exact canonical key for a recognized
spelling and leave an unknown value unchanged, including its original formatting.
The comparison key is not the replacement text for unknown values. Examples:

```text
nodejs                 → Node.js
node.js                → Node.js
k8s                    → Kubernetes
postgres               → PostgreSQL
Experience with NodeJS → unchanged (not a complete registered value)
Node                   → unchanged (ambiguous)
gRPC                   → unchanged (not RPC)
GitHub Actions         → unchanged (not CI/CD)
```

There are no mappings from cloud to AWS, JVM to Java, CI/CD to GitHub Actions,
GitHub Actions to CI/CD, gRPC to RPC, Distributed Systems to Scalable Systems,
or Node to Node.js. Related concepts must not be substituted even if the old
matching dictionary connects them.

These lookup behaviors are a contract for later implementation. This change
only provides dictionary validation and the comparison-key helper.

## Validation API

[The schema](../schemas/parser-aliases.schema.json) declares Draft-07 and validates
root type, dynamic property names, array values, string formatting, and exact
array duplicates. `additionalProperties` is an array schema, not `false`, because
canonical names are the data rather than a fixed set of object fields.

[The validator](../lib/job-parser/validate-aliases.mjs) loads that local schema
relative to its module and compiles it with the existing AJV dependency. It uses
no remote schema loader, coercion, defaults, or additional-property removal.

```js
import {
  aliasComparisonKey,
  validateParserAliases,
} from "../lib/job-parser/validate-aliases.mjs";

aliasComparisonKey("  NODEJS  "); // "nodejs"; comparison only
validateParserAliases({ "Node.js": ["NodeJS"] });
// { valid: true, errors: [] }
```

`aliasComparisonKey` requires a string and throws a TypeError otherwise.
`validateParserAliases` accepts a parsed dictionary value and returns
`{ valid, errors }` without changing it. It performs structural validation first;
relationship checks only run for structurally valid dictionaries.

- `schema` errors contain copied AJV details, including `instancePath`, `keyword`,
  `params`, and `message`. Property-name errors also identify the invalid name.
- `duplicate` errors identify an alias redundant with its own canonical spelling
  or another alias for the same canonical name after comparison normalization.
- `collision` errors identify spellings owned by different canonical names.

Relationship errors include `key`, `first`, and `second`. Both entries identify
`canonical`, `spelling`, `role` (`canonical` or `alias`), and a JSON Pointer `path`.
For canonical names the path identifies that dictionary entry; aliases include
an array index. `/` and `~` in names are escaped according to JSON Pointer rules.

For example, `{ "A": ["Shared"], "B": ["SHARED"] }` fails with a collision
between `/A/0` and `/B/0`. Canonical-to-canonical and canonical-to-alias collisions
also fail. Exact duplicate aliases may be reported as schema errors; case-only
duplicates are caught by the relationship pass. Validation never picks a winning
mapping, deduplicates data, or returns a partial dictionary. Error ordering
follows dictionary insertion order, but acceptance does not depend on that order.

This validates a parsed JSON object. Duplicate raw JSON property names already
lost during `JSON.parse` cannot be recovered by this validator. Semantic lexical
equivalence likewise requires review; a structurally valid but unsafe mapping
cannot be detected by collision checks alone.

## Tests and maintenance

```sh
npm run test:parser-aliases
npm run test:schemas
npm run test:preprocess
```

The focused tests run offline with Node's test runner. They check the approved
dictionary, dynamic keys, malformed entries, duplicates and collisions, error
locations, unchanged inputs, comparison rules, required approved spellings, and
prohibited relationships. Dictionary ownership assertions are test-only checks,
not a runtime normalizer. Existing schema and preprocessing suites cover their
unchanged boundaries.

Each future alias change must update the review rationale and appropriate tests.
Never add a matching relationship to parser aliases merely because it helps
candidate coverage. Extract source wording first and retain original extraction
results and evidence before normalization. Approved aliases establish neither
source grounding nor required/preferred strength or item kind. Grounding and
preservation of original versus normalized extraction results remain later work.
