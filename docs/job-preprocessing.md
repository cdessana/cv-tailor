# Job description preprocessing

`lib/job-parser/preprocess.mjs` exports the synchronous, deterministic
`preprocessJobDescription(text)` function. It accepts a string and returns a new
internal document representation. It performs no I/O and is not wired into the
pipeline. `lib/job-parser/sections.mjs` builds sections and source units from
internal line records; callers should use the preprocessing entry point.

```js
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";

const document = preprocessJobDescription(
  "Requirements\r\n• Node.js\r\n  and JavaScript\r\n\r\nBenefits:\r\nPaid leave"
);
```

The result has this structure:

```text
document
  originalText: unchanged input string
  normalizedText: normalized formatting, with line/paragraph boundaries
  sections: ordered array
    heading: null or { text, originalText, start, end }
    signal: null | required | preferred | responsibilities
    units: ordered array
      type: bullet | paragraph
      text: normalized content, joining continuation lines with spaces
      originalText: exact contiguous source excerpt
      start: inclusive original UTF-16 offset
      end: exclusive original UTF-16 offset
      indentation: original leading whitespace of the unit's first line
```

In the example, the first section has signal `required` and one bullet with text
`Node.js and JavaScript`. The `Benefits` section has no signal and contains the
paragraph `Paid leave`.

This internal structure is not extraction output and does not conform to the
intermediate extraction schema. Null denotes absent headings/signals here; the
extraction schema's rules are unchanged. No unit receives a semantic kind,
requirement classification, canonical technology name, or score.

## Formatting and source preservation

- LF, CRLF, and standalone CR are recognized as line endings. Normalized text
  uses LF.
- Horizontal whitespace, including tabs and nonbreaking spaces, is collapsed
  within content; leading/trailing horizontal whitespace is removed from the
  normalized line. Original indentation is retained on each source unit.
- Repeated blank lines become one blank line in normalized text. Leading and
  trailing blank lines are omitted there, but never removed from `originalText`.
- Recognized bullet markers are rendered as `- ` in normalized text and omitted
  from the unit's content text. Supported markers are `-`, `*`, `+`, `•`, `◦`,
  `▪`, and digit sequences followed by `.` or `)`, with horizontal whitespace
  after the marker. Punctuation without that separator is not a bullet.
- Wording, case, accents, punctuation within content, and conjunctions remain
  unchanged. No Unicode compatibility normalization or alias lookup occurs.

Source offsets are zero-based JavaScript string indices: UTF-16 code units, not
bytes or Unicode code points. Heading/unit ranges include original indentation
and bullet/heading markers, plus line endings between continuation lines. They
exclude the final line's terminator and surrounding blank lines. For every
heading and unit:

```js
document.originalText.slice(entry.start, entry.end) === entry.originalText;
```

The complete original document preserves even content outside those ranges.
Offsets are captured before normalization; normalized text is not used to
calculate provenance. Excerpts make later evidence validation possible, but do
not establish that a future extraction is supported by the source.

## Heading boundaries and signals

Known headings must occupy a whole non-bullet line. Matching ignores case,
repeated horizontal whitespace, straight versus curly apostrophes, a trailing
colon, and Markdown ATX heading prefixes (`#` through `######`, followed by
whitespace). Optional space-separated closing Markdown hashes are recognized.
These transformations are used for recognition; original heading text is kept.
The heading's `text` removes heading markers and a trailing colon while
preserving its wording and case.

| Signal             | Exact heading vocabulary                                           |
| ------------------ | ------------------------------------------------------------------ |
| `required`         | Requirements; Required Qualifications; Must Have; What You'll Need |
| `preferred`        | Preferred Qualifications; Nice to Have; Bonus; Desirable           |
| `responsibilities` | Responsibilities; What You'll Do; Your Role                        |

These are section signals only. For example, `Kubernetes is nice to have` inside
`Requirements` remains unchanged and receives no item classification.
`responsibilities` is not the extraction schema's classification field; later
extraction may identify kind `responsibility` with classification
`not-applicable`.

Unknown Markdown headings also establish sections with signal null. An unknown
plain-text label is recognized only when it ends with a colon, has one to six
whitespace-separated words, and contains no internal `.`, `!`, `?`, or `:`.
This bounded heuristic preserves explicit labels such as `Benefits:` without
guessing that arbitrary short/capitalized lines are headings. Colon-terminated
prose can still be mistaken for a label; unsupported unmarked headings remain
content. No general language understanding or multilingual heading dictionary
is introduced.

Every detected heading starts a new section, including unknown and repeated
headings. Signals never carry across detected headings. Heading-only sections
remain present. Text before the first heading belongs to an unheaded section
with no signal. A completely empty document has no sections.

## Source units

Every bullet starts a separate unit, including indented/nested bullets. Original
indentation is retained as a string rather than assigning a tab width or
inferring parent-child relationships. Normalized text is a reading view, not a
round-trip representation of list indentation.

Non-bullet continuation lines attach to the current unit until a blank line,
heading, or new bullet. This supports copied text with wrapped bullets even when
continuations are not indented. A blank line ends the current unit. Consecutive
prose lines form a paragraph. Dedentation alone does not establish a new unit;
where an unmarked paragraph follows a bullet without a blank line, it remains
part of that bullet. This limitation is preferable to guessing sentence or
semantic boundaries.

A marker followed only by whitespace remains a bullet with empty content; this
stage preserves structure, and is not an extraction validator. A bare marker
without following whitespace is ordinary text. No source content is silently
removed to satisfy the later extraction schema.

Multi-sentence bullets remain intact. Paragraphs are not split into sentences,
avoiding damage to `Node.js`, abbreviations, and qualifications spanning multiple
sentences. Alternatives such as `AWS or GCP` are preserved literally; identifying
alternative groups belongs to extraction.

## Errors and tests

Non-string input throws `TypeError: Job description must be a string.` Empty or
whitespace-only input returns the original input, empty normalized text, and an
empty sections array. A future CLI can decide whether that is an input error.

Run the focused tests with existing project dependencies:

```sh
npm run test:preprocess
npm run test:schemas
```

Preprocessing tests use Node's built-in test runner and inline synthetic raw-text
fixtures. They cover line endings, spacing, markers, continuation lines, nested
bullets, heading variants, unknown headings, unheaded/repeated/empty sections,
source ranges, deterministic results, invalid inputs, and preservation of
punctuation and alternatives. No network, LLM, candidate data, alias dictionary,
or final-job generation is involved.
