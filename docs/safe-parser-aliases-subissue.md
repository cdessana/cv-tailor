# Define a safe alias contract for job-parser normalization

## Summary

Establish a reviewed, parser-specific alias dictionary and its validation rules
before implementing deterministic extraction and normalization.

The current `data/aliases.json` expands candidate matching evidence. It mixes
lexical aliases with related technologies, broader concepts, and evidence-like
phrases. It must not be used directly as a reverse lookup for parser
canonicalization.

This is the next implementation subissue under **Implement job description
parser**. It supplies the missing prerequisite for **Implement deterministic
extraction and safe normalization**.

## Context

The parser may normalize how an explicitly extracted concept is written, but
must not replace it with an inferred, broader, narrower, or merely related concept.

Current matching relationships illustrate the problem:

| Matching key | Included value | Why it is unsuitable for automatic parser normalization |
| --- | --- | --- |
| `RPC` | `gRPC` | Replaces a specific technology with a broader concept |
| `CI/CD` | `GitHub Actions`, `GitLab CI` | Replaces products with an engineering practice |
| `Scalable Systems` | `Distributed Systems` | Treats related concepts as synonyms |
| `Node.js` | `Node` | The standalone word can be ambiguous |

The existing dictionary also lacks `Kubernetes`/`k8s` and
`PostgreSQL`/`postgres`, which appear in the next extraction issue's examples.
Those mappings need explicit review and inclusion rather than an assumption
that the current file already supplies them.

See `docs/job-json-contract.md` for the existing matching behavior and
`docs/job-schemas.md` for the intermediate extraction boundary.

## Goal

Provide a small, explicit set of approved lexical mappings that the future
normalizer can use without changing existing matching behavior or depending on
candidate data.

Extraction must still precede normalization. Dictionary membership is not a
mechanism for extracting concepts from arbitrary prose or proving source support.

## Scope

### 1. Review the existing matching dictionary

Review every current key/value relationship in `data/aliases.json` for suitability
as a context-independent parser alias.

Document which relationships are:

- approved lexical aliases or spelling variants;
- excluded because they express related, broader, or narrower concepts;
- excluded because they are ambiguous without context.

Keep the review traceable to the original entries. A grouped table is sufficient
when several entries share the same decision and rationale.

Do not assume that every matching key or every value needs a parser mapping.
When safe equivalence is uncertain, omit the mapping and preserve the extracted
term unchanged in the later normalization stage.

### 2. Create a separate parser alias dictionary

Create `data/parser-aliases.json` with a canonical-name-to-aliases structure:

```json
{
  "Node.js": ["NodeJS"],
  "Kubernetes": ["k8s"],
  "PostgreSQL": ["postgres"]
}
```

The canonical key is implicitly a recognized spelling of itself; it need not be
repeated in its alias array. Empty arrays are allowed for deliberately registered
canonical names that only need case normalization. Include only reviewed entries;
this is not a comprehensive technology taxonomy.

The initial approved set must cover the next issue's examples:

```text
nodejs → Node.js
node.js → Node.js
k8s → Kubernetes
postgres → PostgreSQL
```

Review other current lexical candidates, such as `Mongo DB`, `DDD`, and
`Google Cloud Platform`, before including them. Do not copy the existing matching
dictionary wholesale.

Leave `data/aliases.json` and all its consumers unchanged. This separate file
supersedes the parent issue's assumption that the matching dictionary can also
serve directly as a safe normalization dictionary.

### 3. Define exact lookup and collision rules

Document these rules for the future normalizer:

- Lookup operates on an already extracted complete value, never on substrings
  inside arbitrary text.
- For lookup comparison, trim surrounding whitespace, collapse repeated
  whitespace, and lowercase using JavaScript's locale-independent
  `toLowerCase()`.
- Do not remove punctuation, strip accents, perform stemming, apply Unicode
  compatibility normalization, or infer context during lookup.
- Both canonical keys and listed aliases participate in lookup using those same
  comparison rules.
- A recognized value resolves to the canonical key's exact stored spelling.
- An unrecognized value remains unchanged, including its original spelling;
  comparison normalization must not rewrite unmatched values.
- A canonical key or alias must not resolve to multiple canonical concepts.
  Reject collisions rather than choosing the first entry.
- Duplicate aliases under the same canonical key, including duplicates of its
  implicit canonical spelling after comparison normalization, are rejected as
  redundant entries.

Require dictionary entries to use nonblank strings without leading/trailing or
repeated whitespace. Internal canonical punctuation and capitalization are
preserved. Detect collisions using the future lookup comparison rules, not only
raw string equality.

These rules must exclude transformations such as:

```text
cloud → AWS
JVM → Java
CI/CD → GitHub Actions
GitHub Actions → CI/CD
gRPC → RPC
Distributed Systems → Scalable Systems
Node → Node.js
```

Excluding a mapping does not remove those concepts from extraction or matching.
It means the parser must preserve them unless another explicitly approved lexical
mapping applies.

### 4. Validate the dictionary contract

Add a JSON Schema for the dictionary and focused offline tests using the existing
AJV and Node test tooling.

The schema should validate the canonical-key-to-string-array structure and
string constraints. Reject non-object roots, non-array values, invalid alias
item types, and blank or improperly spaced entries.

Canonical names are dynamic property names, so the schema must validate them
with `propertyNames` and validate each property's value as an alias array.
Do not set `additionalProperties: false` in a way that rejects legitimate
canonical keys.

Add a small deterministic dictionary validator for relationships JSON Schema
alone cannot conveniently enforce: normalized duplicate spellings and collisions
across canonical keys and aliases. It may contain the shared comparison-key
helper needed for that validation, but must not implement extraction or runtime
normalization of job items.

Validation must report invalid dictionaries explicitly and must not mutate,
coerce, silently deduplicate, or repair the input.

### 5. Document the boundary with later work

Document that:

- the matching dictionary and parser dictionary serve different purposes;
- source wording must be extracted and retained before normalization;
- evidence validation remains necessary even for an approved alias;
- lexical mapping does not establish required/preferred strength or item kind;
- runtime normalization and preservation of original versus normalized extraction
  results belong to the next extraction/normalization subissue;
- adding or changing parser aliases requires review and tests.

## Suggested files

```text
data/parser-aliases.json
schemas/parser-aliases.schema.json
lib/job-parser/validate-aliases.mjs
tests/parser-aliases.test.mjs
docs/parser-aliases.md
```

Add a documented focused test command, for example:

```sh
npm run test:parser-aliases
```

## Acceptance criteria

- [ ] Every existing matching dictionary relationship has a documented approval
      or exclusion decision with a rationale; uncertain relationships are excluded.
- [ ] A separate parser alias dictionary contains only explicitly approved
      lexical mappings.
- [ ] The initial dictionary supports the specified `nodejs`, `node.js`, `k8s`,
      and `postgres` lookup examples under the documented comparison rules.
- [ ] Ambiguous and related-concept mappings listed above are excluded.
- [ ] Complete-value matching, case/whitespace handling, punctuation preservation,
      canonical spelling, and unchanged unknown-value behavior are explicit.
- [ ] The dictionary schema declares its JSON Schema dialect and rejects malformed
      roots, values, keys, and alias entries.
- [ ] Normalized duplicates and canonical/alias collisions are rejected, including
      canonical-to-canonical, canonical-to-alias, and alias-to-alias collisions.
- [ ] Positive and negative tests cover the approved dictionary, malformed
      dictionaries, duplicate spellings, collisions, and prohibited relationships.
- [ ] Validation leaves input unchanged and runs offline through a documented command.
- [ ] Existing schema and preprocessing tests continue to pass.
- [ ] `data/aliases.json`, current consumers, and existing extraction/final job
      schemas remain unchanged.
- [ ] No runtime extraction or job-item normalization is introduced.

## Non-goals

- Implementing `extract.mjs` or `normalize.mjs`.
- Integrating the dictionary into the runtime pipeline.
- Refactoring the existing matching dictionary or changing matching scores.
- Context-sensitive disambiguation or fuzzy/substring matching.
- LLM calls, semantic extraction, or candidate-data access.
- Evidence-grounding implementation.
- Alternative-group processing or compatibility mapping.
- Changing the intermediate extraction or final job schemas.
- Introducing ESCO/O*NET, a broad technology taxonomy, or new dependencies.

## Depends on

- **Document current job JSON contract** — completed; supplies the verified
  matching dictionary behavior and limitations.

This issue follows the completed schema and preprocessing work in the planned
implementation sequence, but its semantic prerequisite is the documented alias
contract.

## Unblocks

- **Implement deterministic extraction and safe normalization**.

Update that issue to depend on this subissue and use `data/parser-aliases.json`
for normalization instead of the matching-oriented `data/aliases.json`.
