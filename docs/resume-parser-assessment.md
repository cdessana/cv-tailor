# Resume parser implementation assessment

This assessment records the repository inspection, reuse decisions, and
external prior-art evaluation for the resume parser. It is intentionally
separate from the runtime candidate and review report.

## 1. Current resume input flow

Before this parser, `config.paths.baseResume` was loaded directly by the CLI and
web pipeline. The new path is additive:

```text
existing JSON Resume ───────────────────────────────┐
                                                   ▼
TXT / MD / PDF → resume parser → reviewed candidate → existing pipeline
```

The parser never promotes its output automatically and protects the configured
master path from direct writes.

## 2. Current resume/schema format

JSON Resume remains canonical. The implementation reuses the repository's
vendored schema, AJV, and `ajv-formats`. Provenance, ambiguity, and source layout
metadata remain in the report rather than extending the resume schema.

## 3. Current LLM abstraction

CV Tailor already has provider adapters used by job parsing. The resume parser
does not currently need an LLM: extraction is deterministic and local. If a
semantic fallback is introduced later, it should reuse those adapters and must
not add a parallel provider/client layer.

## 4. Validation and factual guard rails reused

- existing JSON Resume validation conventions;
- schema validation before candidate acceptance;
- structured issue and human-review patterns;
- source-grounding principles used by job parsing;
- no-live-network test conventions;
- explicit failure instead of speculative output.

Resume-specific tests additionally enforce numeric preservation, cautious
wording, role isolation, evidence-type separation, and no inferred skills or
technologies.

## 5. Downstream modules affected

No downstream data contract changed. The generated candidate is consumed by:

- `scripts/analyse.mjs`, which reads work highlights and skill keywords;
- `scripts/tailor.mjs`, which reads the canonical resume plus analysis/evidence;
- rewrite and summary stages, which continue to receive JSON Resume;
- `scripts/validate.mjs`, `scripts/ats-validate.mjs`, and
  `scripts/final-check.mjs`;
- `scripts/render.mjs` and installed JSON Resume themes.

An integration test generates a candidate and passes it through schema
validation, analysis, tailoring, and HTML theme rendering.

## 6. Existing document extraction utilities reused

The project already expects Poppler for PDF inspection. The parser reuses local
`pdftotext`, adding `-bbox-layout` so layout and source coordinates can be
retained. TXT and Markdown use Node.js `fs`. No document extraction package was
added.

## 7. External references reviewed

### REUSED

- [JSON Resume schema](https://jsonresume.org/schema): canonical output model
  and compatibility target.
- Existing CV Tailor AJV/schema validation infrastructure.
- Existing local Poppler/`pdftotext` capability.
- Existing CV Tailor pipeline and factual-safety conventions.

### ADAPTED

- [OpenResume-style deterministic parsing](https://github.com/dhanushk-offl/resume-parser):
  section detection, line reconstruction, date normalization, bullet handling,
  and multi-column parsing were used as architectural ideas, not imported code
  or a runtime dependency.
- Affinda-style API boundaries and evidence concepts: separate extraction,
  normalized output, provenance, and explicit error contracts were adapted as
  design concepts.
- Common LLM-parser pipelines were used as a contrast for preserving an
  explicit deterministic extraction and validation boundary.

### REIMPLEMENTED

- source-line and PDF-coordinate provenance;
- conservative field and section extraction;
- date precision normalization and validation;
- ambiguity/conflict review records;
- transactional candidate/report publication;
- factual and anti-inference test gates.

These components are local because CV Tailor needs direct control over every
transformation and its source evidence.

### NOT USED

- [perminder-klair/resume-parser](https://github.com/perminder-klair/resume-parser)
  as a dependency: its file-dispatch and rule-pipeline organization were
  reviewed, but adopting the older dependency model would add coupling and
  external runtime concerns.
- [Affinda Resume Parser](https://github.com/affinda/resume-parser) runtime or
  hosted service: it would compromise the default local-first requirement and
  make transformation provenance dependent on an external parser.
- Large opaque resume-parsing frameworks.
- Hosted resume parsing or commercial enrichment services.
- Automatic skill enrichment, company lookup, or seniority inference.
- A standalone LLM resume parser/client.

## 8. Direct dependencies

No new direct dependency was introduced.

| Capability | Decision |
| --- | --- |
| TXT/Markdown | Node.js `fs` |
| PDF | Existing local `pdftotext`/Poppler capability |
| Schema validation | Existing AJV and vendored JSON Resume schema |
| HTML compatibility check | Existing `resumed` and installed theme |
| DOCX | Deferred; evaluate `mammoth` in a follow-up |

This minimizes transitive size, avoids network services, and keeps ESM/Node.js
compatibility aligned with the current project.

## 9. Ideas adapted from prior art

- format dispatch before semantic parsing;
- normalized intermediate source-document representation;
- section-aware parsing instead of global field matching;
- layout-aware PDF line reconstruction;
- normalized but precision-preserving date ranges;
- separate confidence/evidence or review metadata;
- structured parser API and stable failures.

## 10. Components intentionally not reused

The implementation does not reuse an entire external parser, external schema,
hosted API, OCR engine, document renderer, or LLM extraction stack. These would
either duplicate existing infrastructure, expand the first-release scope, or
weaken local provenance guarantees.

## 11. Implemented file surface

- `lib/resume-parser/read-source.mjs`: format dispatch and local extraction;
- `lib/resume-parser/layout.mjs`: source-document normalization and PDF layout;
- `lib/resume-parser/parse.mjs`: orchestration and section routing;
- `lib/resume-parser/basics.mjs`, `work.mjs`, `education.mjs`, and
  `sections.mjs`: focused field extraction;
- `lib/resume-parser/dates.mjs`: precision-preserving dates;
- `lib/resume-parser/extracted-entry.mjs`: value/source separation;
- `lib/resume-parser/conflicts.mjs`: duplicate/conflict review;
- `lib/resume-parser/assemble.mjs` and `validate.mjs`: canonical assembly and
  schema validation;
- `lib/resume-parser/errors.mjs`: stable failure contract;
- `scripts/resume-parser.mjs`: CLI and transactional artifacts;
- parser unit, safety, fixture, and integration tests;
- README and dedicated parser documentation.

## 12. Compatibility risks

- PDF reading order varies across generators; unusual layouts may need new
  deterministic layout fixtures.
- Pattern-based section detection can miss uncommon headings.
- Conservative omission can require more manual review than semantic parsing.
- JSON Resume themes differ in how they display optional fields and partial
  dates, although the candidate remains schema-valid.
- Poppler availability differs by operating system and is reported by the
  environment doctor.
- Future semantic extraction could introduce unsupported facts unless it is
  gated by the existing provider abstraction, provenance, and factual tests.

These risks are contained by separate review artifacts, schema validation,
structured failures, deterministic tests, and manual promotion to the master
resume.
