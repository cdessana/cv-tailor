# Deterministic extraction and normalization

This stage reads the [preprocessing result](job-preprocessing.md), extracts a
bounded set of explicit requirements, and separately normalizes registered
spellings using [parser aliases](parser-aliases.md). It does not use the matching
alias dictionary, generate final job JSON, or call existing pipeline consumers.

```js
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import { extract } from "../lib/job-parser/extract.mjs";
import { normalizeExtraction } from "../lib/job-parser/normalize.mjs";

const document = preprocessJobDescription(
  "Requirements\n• Experience with nodejs is required"
);
const { extraction, unresolved } = extract(document);
const normalized = normalizeExtraction(extraction);
// extraction.items[0].value === "nodejs"
// normalized.items[0].value === "Node.js"
// Both keep evidence.quote === "• Experience with nodejs is required"
```

## API and boundaries

`extract(document, dictionary?)` accepts an unchanged result of
`preprocessJobDescription`. It checks this contract by reconstructing the
preprocessing result from `originalText` and comparing it, rejecting malformed or
altered units/ranges rather than trusting mismatched excerpts. This is structural
source consistency, not semantic evidence validation. It does not mutate input.

The return envelope is `{ extraction: { items: [...] }, unresolved: [...] }`.
Only `extraction` conforms to the existing intermediate schema. Each unresolved
record contains a cloned `unit`, `heading`, `signal`, and `reason`. Units retain
original text, normalized text, and source ranges for subsequent extraction.
Heading-only sections remain available in the caller's original document.
No metadata extraction is performed.

`normalizeExtraction(extraction, dictionary?)` validates input and returns a
separate intermediate object. Retain the original extraction to preserve original
values; no `originalValue` property is added to the closed schema. Metadata,
evidence, source sections, kinds, and classifications are copied without changes.

Both functions default to `data/parser-aliases.json` and validate the dictionary
before using it. Internal `extraction-contract.mjs` shares local schema validation
and dictionary indexing. Schema and dictionary files resolve relative to the
modules. AJV uses strict mode without coercion, defaults, property removal, or
network fetching. Extraction output and normalization input/output are checked
against the unchanged intermediate schema. None of this is integrated into the
current runtime pipeline.

## Supported grammar

Rules match whole normalized source units, ignoring cue capitalization and
allowing one terminal period or exclamation mark:

| Pattern                          | Classification |
| -------------------------------- | -------------- |
| `Experience with X is required`  | `required`     |
| `X is required`                  | `required`     |
| `Required: X`                    | `required`     |
| `Nice to have: X`                | `preferred`    |
| `Preferred: X`                   | `preferred`    |
| `Experience with X is preferred` | `preferred`    |

Under `required` or `preferred` section signals, `Experience with X` also works.
A standalone registered technology spelling under those headings is supported.
Explicit preferred wording overrides a required heading (and an explicit required
cue overrides a preferred heading). Responsibilities sections are deferred as a
whole, avoiding conversion of activities into qualifications.

Captured values retain spelling and capitalization; preprocessing has already
normalized formatting. Evidence uses the exact original source-unit excerpt,
including bullet markers and original line endings. If present, the section's
heading text supplies `sourceSection`.

Technology recognition is deliberately limited to already reviewed canonical
names `REST APIs`, `GCP`, `RPC`, `CI/CD`, `Node.js`, `MongoDB`, `Kubernetes`, and
`PostgreSQL`, including their registered aliases. These get kind `skill`; other
explicitly captured qualifications get kind `requirement`. This does not rewrite
values during extraction. Unknown technologies can still be captured by explicit
patterns, but are not assumed to be skills. Responsibilities and competencies
are not extracted in this iteration.

A captured option is limited to eight whitespace-separated words, starting with
a letter, number, or period, and containing letters, numbers, spaces, periods,
`+`, `#`, `/`, and `-`. This admits simple names and qualifications such as
`Five years of experience`; it is not a general phrase parser. Parenthetical
forms may be recognized by normalization of an existing intermediate object but
remain outside this extraction grammar.

## Conservative fallback and alternatives

The following remain unresolved rather than partially extracted:

- Negation/qualification markers: `not`, `no`, `never`, `without`, `optional`,
  `unless`, `except`, `if`, `but`, and `however`.
- Captured expressions containing additional cue/clause words: `and`, `is`,
  `are`, `required`, `preferred`, `must`, `should`, `have`, `with`, `which`,
  `that`, `including`, `such`, and `either`.
- Multiple sentences indicated by a period followed by whitespace, semicolons,
  colons, remaining exclamation/question marks, or parentheses in the value.
- Unsupported whole-unit patterns and expressions beyond the bounded grammar.

Reasons are `negated-or-qualified`, `unsupported-pattern`,
`unsupported-expression`, or `unsupported-section`. These guards deliberately
prefer unresolved content and are not comprehensive natural-language negation or
contradiction detection. Later semantic extraction must handle unsupported cases.

Simple `X or Y`, repeated OR chains, and comma lists ending with one explicit OR
connector (`AWS, GCP, or Azure`) become a single `alternative` item with operator
`anyOf`. Kind is `skill` only when every option is a recognized technology;
otherwise it is `requirement`. Evidence and classification apply to the group.
Comma-only lists, mixed AND/OR, nested expressions, incomplete options, and exact
duplicate options are deferred. No OR group is flattened into mandatory items.

## Normalization

Complete extracted values and individual alternative options are looked up using
the validated parser dictionary. The comparison key handles whitespace and case
only; output uses exact canonical spelling. Unregistered values remain byte-for-
byte unchanged as JavaScript strings, including surrounding whitespace in a
caller-supplied valid intermediate object. Metadata is not normalized.

Examples include `nodejs → Node.js`, `k8s → Kubernetes`, and
`postgres → PostgreSQL`. `cloud`, `JVM`, `gRPC`, and `GitHub Actions` remain
unchanged. A larger phrase such as `Experience with NodeJS` is not replaced by
substring lookup.

If normalization produces identical options inside an alternative group, it
throws instead of deduplicating, flattening, or returning a partial result.
For example, `nodejs or Node.js` is structurally valid before normalization but
cannot be accepted as two distinct normalized options. The caller still retains
the original extraction. Deciding how to simplify such a group is deferred.

Malformed documents, dictionaries, and intermediate objects fail explicitly.
Unsupported source wording is normal unresolved output, not an exception.
Empty preprocessed input returns empty items and unresolved arrays.

## Tests

```sh
npm run test:extraction
npm run test:parser-aliases
npm run test:preprocess
npm run test:schemas
```

Tests use synthetic text and run offline. They cover explicit patterns, heading
precedence, unresolved wording, alternatives, safe versus inferred mappings,
original source preservation, immutable results, malformed boundaries, and the
preprocessing-to-extraction-to-normalization path. Successful schema validation
does not prove semantic grounding; evidence validation and final compatibility
mapping remain separate work.
