# Resume parser

The resume parser is an additional, local-first entry point into CV Tailor. It
converts an existing resume into a reviewable JSON Resume candidate; it does not
tailor, enrich, or automatically promote that candidate to the master resume.

## Architecture

```text
 TXT / Markdown                  text-based PDF
       │                              │
       │ Node.js fs                   │ pdftotext -bbox-layout
       └──────────────┬───────────────┘
                      ▼
             normalized source document
              (text + sourced lines)
                      │
                      ▼
       deterministic section and field extractors
                      │
             ┌────────┴────────┐
             ▼                 ▼
    JSON Resume candidate   provenance + issues
             │                 │
             └────────┬────────┘
                      ▼
          deterministic schema validation
                      │
                      ▼
              human review and approval
                      │
                      ▼
      configured paths.baseResume (manual promotion)
                      │
                      ▼
        analyse → tailor → rewrite → validate → render
```

The implementation keeps three boundaries separate:

1. `read-source.mjs` and `layout.mjs`: document to normalized sourced text;
2. section extractors and `parse.mjs`: sourced text to structured proposal;
3. `assemble.mjs` and `validate.mjs`: proposal to validated JSON Resume.

This lets future DOCX or OCR adapters produce the same source-document shape
without changing the structured extraction layer.

## Supported inputs

| Format | Support | Extraction |
| --- | --- | --- |
| `.txt` | Yes | Node.js file loading |
| `.md`, `.markdown` | Yes | Loaded as text; Markdown rendering is not used |
| text-based `.pdf` | Yes | Local `pdftotext -bbox-layout` |
| `.docx` | No | Planned follow-up |
| scanned/image-only PDF | No | OCR is deliberately out of scope |
| images | No | OCR and image parsing are out of scope |

PDF extraction reconstructs lines and columns from Poppler bounding boxes and
retains page and coordinate information where available. Poppler must be
installed and `pdftotext` must be available on `PATH`.

## CLI

```bash
npm run resume:parse -- \
  --input /path/to/resume.pdf \
  --output data/resumes/imported.json
```

Specify a custom report path when needed:

```bash
npm run resume:parse -- \
  --input /path/to/resume.md \
  --output data/resumes/imported.json \
  --report output/resume-parser/import-report.json
```

The output and report paths must differ. The parser refuses to write to the
configured `paths.baseResume`; promotion remains an explicit human action.

## Generated artifacts

The candidate contains only JSON Resume fields. The separate report contains:

- `status`: `ready`, `review_required`, or `failed`;
- section counts;
- factual-grounding counts (`valuesChecked`, `groundedValues`,
  `provenanceRecords`, and `errors`);
- structured review issues;
- JSON Pointer-style provenance records.

If no `--report` is supplied, the report is written beside the candidate as
`<candidate>.report.json`. Candidate and report publication is transactional:
both new files are installed, or previous versions are restored. A schema
failure writes the diagnostic report but does not publish a candidate.

## JSON Resume compatibility

The parser uses the vendored JSON Resume schema in
`schemas/jsonresume.schema.json` and the existing AJV validation path. It does
not define a second canonical resume model. Generated candidates are consumed
without conversion by validation, analysis, tailoring, and JSON Resume theme
rendering; this path is covered by an integration test.

Parser-only fields never enter the candidate. For example:

```json
{
  "path": "/work/0/highlights/0",
  "source": {
    "page": 1,
    "lineStart": 12,
    "lineEnd": 12,
    "text": "Reduced API latency by 37%.",
    "format": "txt"
  }
}
```

## Grounding and safety rules

The deterministic parser copies explicitly represented facts. It does not use
an LLM and does not make network requests.

- Date precision is preserved as year, month, or day; missing components are
  not synthesized.
- Numbers and metrics are copied verbatim in summaries and highlights.
- Highlights remain attached to the work block in which they occur.
- Technologies are not inferred from titles, certificates, or neighboring
  roles.
- Skill levels are emitted only from explicit level syntax.
- Certificate evidence remains a certificate and is not converted to work
  experience.
- Unsupported or ambiguous blocks are omitted from the candidate and surfaced
  in the review report.
- Duplicate and conflicting entries require review.
- Invalid dates produce section-specific review issues.

Every scalar value in the candidate must have a source record. Before a
candidate is published, the grounding gate verifies that the source exists in
the input document, supports the extracted text and numbers, preserves date
precision, and remains inside the correct work entry. A grounding violation
sets the report status to `failed` and prevents candidate publication.

The tests include explicit negative assertions for invented technologies,
strengthened attribution, changed metrics, cross-role mixing, inferred skills,
network access, and partial artifacts after extraction failure.

## Review workflow

1. Run the parser to a candidate path other than `paths.baseResume`.
2. Inspect the candidate and its report together.
3. Resolve every `review_required` issue against the original document.
4. Run `node scripts/validate.mjs <candidate.json>` if manually editing it.
5. Promote the reviewed candidate to the configured master path manually.
6. Run the normal CV Tailor pipeline.

`ready` means deterministic validation found no known ambiguity. It is not a
claim that every possible resume layout was understood, so visual comparison
with the source remains recommended.

## Minimum recognizable content and report status

A source is recognizable as a resume only when the parser finds a candidate
name and at least one independent resume signal, such as contact information,
a professional profile, work, education, skills, certificates, or languages.
This intentionally rejects arbitrary prose and near-empty documents.

- `ready`: schema, content, and factual-grounding checks passed without a known
  ambiguity.
- `review_required`: the candidate is valid and grounded, but one or more
  ambiguous or unsupported source blocks need human review.
- `failed`: the input is malformed, the JSON Resume candidate is invalid, or a
  factual-grounding error makes publication unsafe.

## Structured failures

CLI failures are printed as JSON with a stable `code` and `message`. Important
codes include:

- `RESUME_FORMAT_UNSUPPORTED`;
- `RESUME_SOURCE_READ_FAILED`;
- `RESUME_TEXT_EXTRACTION_FAILED`;
- `RESUME_ARGUMENT_ERROR`;
- `RESUME_CONFIG_ERROR`;
- `RESUME_VALIDATION_FAILED`;
- `RESUME_MALFORMED_INPUT`;
- `RESUME_GROUNDING_FAILED`;
- `RESUME_OUTPUT_PROTECTED`;
- `RESUME_OUTPUT_PATH_CONFLICT`;
- `RESUME_REPORT_WRITE_FAILED`;
- `RESUME_OUTPUT_WRITE_FAILED`.

## Extraction conventions

The parser recognizes common English and Portuguese section headings. It
supports delimited and multi-line work and education records. Explicit examples
include:

```text
Example Corp | Backend Engineer | Manaus, AM | 2021-04 - 2023-06
Example University | Bachelor of Science | Computer Science | 2015 - 2019
Cloud Certification | Example Institute | 2022-05 | https://example.com/cert
Backend (Advanced): Node.js, PostgreSQL
```

Location, area, certificate metadata, and skill levels are omitted when their
meaning cannot be determined conservatively.

## Limitations

- DOCX is not yet supported.
- Scanned PDFs require OCR and fail explicitly.
- Highly decorative, overlapping, or unusual PDF layouts may need manual
  reconstruction even when text is extractable.
- Section and record detection is deterministic and pattern-based; uncommon
  headings or unconventional ordering may produce review issues.
- No semantic/LLM fallback is currently enabled. If added later, it must use the
  existing provider abstraction, remain optional, and pass the same grounding
  and deterministic validation gates.
- The parser does not enrich profiles, infer seniority, infer technologies, or
  rewrite content.

See [Resume parser implementation assessment](resume-parser-assessment.md) for
the dependency and prior-art decisions.
