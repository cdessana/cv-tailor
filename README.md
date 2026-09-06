# CV Tailor

A local-first CV tailoring pipeline that adapts a master resume to a specific job description while preserving factual accuracy.

The core principle is simple:

> The job determines what should be emphasized.  
> Your career determines what can be claimed.

CV Tailor compares a job description against a structured resume and a separate career evidence database, selects the most relevant experience, optionally rewrites content with a local LLM, validates factual consistency, and renders an ATS-friendly PDF.

---

## Why this project exists

Tailoring a CV for every job is useful, but doing it manually is repetitive and error-prone.

Using an LLM alone introduces another problem: it can easily make a resume sound stronger by inventing technologies, responsibilities, impact, or experience that never existed.

CV Tailor was designed to avoid that.

Instead of asking an AI to simply “rewrite my resume for this job”, the pipeline separates:

- what the job requires;
- what the resume currently presents;
- what the candidate can factually support;
- what can safely be rewritten;
- what must remain unsupported.

The result is a tailored resume without turning keyword optimization into fabrication.

---

## How it works

```text
Master Resume
     +
Career Evidence
     +
Job Description
     ↓
Analyse
     ↓
Tailor
     ↓
Rewrite (Optional)
     ↓
Generate Summary
     ↓
Final Fact Check
     ↓
Schema Validation
     ↓
Render (Dynamic Theme & Page Layout)
     ↓
PDF
     ↓
ATS / Content Sanity Checks
```

The execution flow is:

```text
base.json
job.json
aliases.json
evidence.json
    ↓
analyse.mjs
    ↓
analysis.json
    ↓
tailor.mjs
    ↓
tailoring-plan.json
resume.json
    ↓
rewrite.mjs
    ↓
resume-rewritten.json (or resume.json if skipped)
rewrite-report.json
    ↓
summary.mjs
    ↓
resume-final.json
summary-report.json
    ↓
final-check.mjs
    ↓
render.mjs (auto-installs theme, applies @page size & margins)
    ↓
resume.html
resume.pdf
resume.txt
```

## Design principles

### 1. Never invent experience

A technology appearing in a job description is not enough to add it to the CV.

A claim must be supported by either:

- the original resume;
- the career evidence database;
- another explicitly verified source.

Unsupported requirements remain unsupported.

### 2. Resume and evidence are separate

The project intentionally keeps two different representations of career information.

`base.json` is the resume:

> What do I currently present?

`evidence.json` is the factual career memory:

> What can I support if a job makes it relevant?

This prevents the master resume from becoming a giant archive of every project, technology, responsibility, and historical detail.

### 3. Evidence is contextual

Evidence is stored at the project or role level whenever possible.

For example:

```text
Company A
 ├── Project X
 │    ├── Node.js
 │    ├── MongoDB
 │    └── Angular
 │
 └── Project Y
      ├── C#
      ├── .NET 6
      ├── REST
      └── gRPC
```

This matters because simply knowing that someone has experience with both MongoDB and gRPC does not mean those technologies were used together.

The pipeline tries to avoid creating combinations of facts that never occurred in the same context.

### 4. Different evidence levels remain different

The project distinguishes between concepts such as:

```text
professional experience
familiarity
certification
coursework
related experience
unsupported requirement
```

For example, having studied a technology is not treated as production experience.

### 5. LLMs rewrite — they do not decide truth

The local LLM is used as a controlled rewriting layer.

It can improve phrasing and relevance, but factual validation happens outside the model.

If a generated bullet introduces unsupported technologies, numbers, causal claims, or loses required context, the rewrite is rejected.

The pipeline then falls back to the original factual bullet or a deterministic evidence-based sentence.

## Project structure

```text
cv-tailor/
├── cv-tailor.config.json      # Centralized pipeline and provider configuration
├── data/
│   ├── resumes/
│   │   └── base.json
│   ├── jobs/
│   │   └── example-job.json
│   ├── aliases.json
│   └── evidence.json
│
├── config/
│   ├── schema.mjs         # Zod configuration schema & validation
│   └── load-config.mjs    # Config loader with root path resolution
│
├── scripts/
│   ├── analyse.mjs
│   ├── tailor.mjs
│   ├── llm.mjs                # Multi-provider LLM adapter (Strategy pattern)
│   ├── rewrite.mjs
│   ├── summary.mjs
│   ├── final-check.mjs
│   ├── render.mjs             # Dynamic JSON Resume renderer & PDF generator
│   ├── validate.mjs
│   └── run.mjs                # Main pipeline orchestrator
│
├── output/
├── eslint.config.mjs          # Flat ESLint configuration
├── .prettierrc                # Prettier code formatting rules
├── package.json
└── README.md
```

## Main data files

### `base.json`

The master resume in JSON Resume-compatible format.

It contains the stable version of:

- profile;
- work experience;
- education;
- skills;
- certifications;
- languages.

It should remain concise.

### `evidence.json`

The factual evidence database.

It stores information that may be relevant for future tailoring but does not necessarily belong in every resume.

Examples include:

- technologies used in specific projects;
- architecture responsibilities;
- leadership activities;
- performance improvements;
- mentoring;
- CI/CD work;
- project-specific responsibilities.

### `aliases.json`

Maps equivalent or related terminology.

This helps the matcher understand that different job descriptions may refer to the same concept using different terms.

Examples:

```text
REST
REST API
RESTful API
REST APIs
```

The matcher still uses phrase-aware matching to reduce substring false positives.

### Job files

Each job description is stored as structured JSON under:

```text
data/jobs/
```

A job may define:

- required technologies;
- preferred technologies;
- competencies;
- metadata;
- original job URL.

## Configuration

CV Tailor uses a centralized configuration file (`cv-tailor.config.json`) validated at runtime via **Zod**.

### Precedence Rules

Configuration values are resolved using strict precedence:

```text
CLI Arguments / Environment Variables
                ↓
    cv-tailor.config.json
                ↓
          Built-in Defaults

```

- Explicit CLI flags (e.g., `--skip-rewrite`, custom themes, `--format`) always override configuration values.
- Environment variables (e.g., `LLM_PROVIDER`, `OPENAI_API_KEY`) override provider settings.
- Missing optional config fields automatically fall back to built-in defaults.

### Example `cv-tailor.config.json`

```json
{
  "llm": {
    "provider": "ollama",
    "ollama": {
      "model": "granite4.2:3b-q4_K_S",
      "url": "http://127.0.0.1:11434"
    },
    "local": {
      "model": "local-model",
      "baseURL": "http://127.0.0.1:1234/v1",
      "apiKey": "not-needed"
    },
    "openai": {
      "model": "gpt-4o-mini",
      "apiKey": ""
    },
    "groq": {
      "model": "llama-3.1-70b-versatile",
      "baseURL": "https://api.groq.com/openai/v1",
      "apiKey": ""
    },
    "anthropic": {
      "model": "claude-3-5-sonnet-20240620",
      "apiKey": ""
    },
    "gemini": {
      "model": "gemini-1.5-flash",
      "apiKey": ""
    }
  },
  "render": {
    "theme": "jsonresume-theme-stackoverflow"
  },
  "paths": {
    "baseResume": "data/resumes/base.json",
    "evidence": "data/evidence.json",
    "aliases": "data/aliases.json",
    "jobs": "data/jobs",
    "output": "output"
  },
  "pipeline": {
    "rewriteEnabled": true,
    "maxBulletsPerRole": 7
  }
}
```

### Path Resolution

All relative paths inside `paths.*` are resolved relative to the project root directory where the process is executed.

---

## Supported LLM Providers

The pipeline decouples prompt execution from model implementations via `scripts/llm.mjs`. Switch providers simply by updating `"provider"` in `cv-tailor.config.json` or passing `LLM_PROVIDER=<name>`.

- **`ollama`**: Local inference via Ollama.
- **`local`**: OpenAI-compatible local endpoints (LM Studio, vLLM, LocalAI).
- **`openai`**: Official OpenAI models (e.g., GPT-4o-mini).
- **`groq`**: Fast cloud open-source inference (e.g., Llama 3.1).
- **`anthropic`**: Claude models via the Anthropic SDK.
- **`gemini`**: Google Gemini models via `@google/generative-ai`.

API keys can be declared in `cv-tailor.config.json` or supplied via standard environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`).

---

## Requirements

The project currently expects:

- macOS
- Node.js 22+
- npm
- Google Chrome
- Poppler (`pdftotext` and `pdfinfo`)
- Ollama for optional local rewriting

Recommended Node version:

```bash
node --version
```

Example:

```text
v22.x
```

## Installation

Install dependencies:

```bash
npm install
```

Install Poppler on macOS:

```bash
brew install poppler
```

If using the local LLM rewriting stage, install Ollama and pull the configured model.

Example:

```bash
ollama pull granite4.2:3b-q4_K_S
```

## Running the pipeline

Run the complete tailoring pipeline for a job:

```bash
node scripts/run.mjs data/jobs/example-job.json
```

The pipeline creates a company-specific output directory:

```text
output/<company>/
```

For example:

```text
output/flash/
├── analysis.json
├── resume.json
├── tailoring-plan.json
├── tailoring-report.json
├── resume-rewritten.json
├── rewrite-report.json
├── resume-final.json
├── summary-report.json
└── final-check.json
```

## Rendering the final resume

The current selected theme is:

```text
jsonresume-theme-stackoverflow
```

Render the final resume with:

```bash
node scripts/render-stackoverflow.mjs   output/<company>/resume-final.json
```

The renderer generates:

```text
resume.html
resume.pdf
resume.txt
```

The `.txt` file is extracted from the PDF and used for content sanity checks.

## Date rendering workaround

The StackOverflow JSON Resume theme has a timezone issue when parsing dates such as:

```text
2024-03
```

Depending on the local timezone, this can incorrectly render as:

```text
Feb 2024
```

CV Tailor does not modify the original resume data to work around this.

Instead, the renderer creates a temporary rendering-only copy and converts:

```text
2024-03
```

into a safe date inside the same month:

```text
2024-03-15
```

The original JSON remains unchanged.

This keeps the career data accurate while avoiding renderer-specific timezone behavior.

## Validation layers

### Matching analysis

Determines how much of a job's requirements can be supported by existing evidence.

This is not an ATS score.

### Rewrite validation

Checks generated bullets for problems such as:

- unsupported technologies;
- invented numbers;
- unsupported causal claims;
- missing required context;
- lost distinctive project details;
- meta commentary generated by the model.

Unsafe rewrites are rejected.

### Final factual check

Checks the tailored resume against:

- the job;
- the selected evidence;
- the master resume;
- known career constraints.

It can emit:

```text
ERROR
WARNING
INFO
```

Warnings may represent factual ambiguities that require human review rather than automatic correction.

### JSON Resume schema validation

The final structured resume is validated before rendering.

### PDF sanity validation

After rendering, the PDF text is extracted and checked for critical information such as:

- name;
- contact information;
- major technologies;
- expected dates;
- important architectural terms.

This also catches theme-related rendering problems that JSON validation alone cannot detect.

## Output philosophy

The pipeline produces multiple intermediate files intentionally.

They make it possible to answer questions such as:

```text
Why was this bullet selected?

Was this sentence generated by the LLM?

Which evidence supports this claim?

Was a rewrite rejected?

What job requirement caused this experience to be emphasized?
```

The final PDF is only one artifact of the process.

Traceability is part of the design.

## Known limitations

The project is still under active development.

Current limitations include:

- evidence data still requires manual curation;
- job descriptions are currently structured manually;
- some theme behavior depends on third-party JSON Resume packages;
- ATS validation is still being integrated;
- role-date overlaps require human review;
- older career roles may not yet have detailed evidence;
- the current renderer assumes Google Chrome is installed at the standard macOS path.

## Roadmap

Planned improvements include:

- automatic job description ingestion;
- richer evidence provenance;
- source metadata for every factual claim;
- evidence confidence levels;
- better alias and semantic matching;
- automatic ATS audit integration;
- configurable renderers;
- improved cross-project fact isolation;
- generalized support for multiple resumes;
- automated tests for factual guard rails;
- a CLI interface;
- optional local UI.

A future goal is to make the system reusable without hardcoded candidate-specific rules.

## Privacy

CV data can contain highly personal information.

For that reason, the project is designed to work locally.

Generated resumes and intermediate files should normally remain outside version control.

Recommended `.gitignore`:

```gitignore
node_modules/
output/
.env
.DS_Store
```

If the repository contains real resume data or private career evidence, using a private repository is strongly recommended.

## Status

This project is currently a working prototype.

The content pipeline can:

- compare a resume with a job;
- identify supported and unsupported requirements;
- select relevant experience;
- recover additional factual experience from an evidence database;
- rewrite bullets using a local LLM;
- reject unsafe rewrites;
- generate a tailored professional summary;
- perform final factual checks;
- render the result as HTML and PDF;
- validate extracted PDF content.

The next focus is making the complete workflow more generic, testable, and reusable.

## License

No license has been selected yet.
