# CV Tailor

A local-first CV tailoring pipeline that adapts a master resume to a specific job description while preserving factual accuracy.

Job descriptions are parsed deterministically first. If unresolved content
remains, the configured job-parser semantic provider is used. The built-in
default is `none`, which fails safely rather than sending content to a model.
Explicitly select Gemini to send job-description content to Google, or Ollama
for an endpoint you control.

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

### Evidence Builder

Run `node scripts/build-evidence.mjs data/resumes/base.json` to create a reviewable candidate under `output/evidence/`. The builder validates the structured resume, keeps each fact in its work context, records JSON Resume provenance, and creates `evidence-candidate.json` plus `evidence-report.json`. Both artifacts are versioned and identify the builder run; each claim preserves its original and whitespace-normalized wording, source reference, and timestamps.

Candidate claims start pending. Review them through the structured API/UI or with `node scripts/review-evidence.mjs decisions.json`; then run `node scripts/promote-evidence.mjs`. Every claim or conflict decision records its actor, timestamp, note, and relevant source snapshot. Promotion is blocked while any claim, ambiguity, or conflict remains unresolved. Only approved claims can be written to canonical `data/evidence.json`, which remains the only evidence source consumed by tailoring.

The report summary separately exposes `conflicts`, `ambiguities`, and `unresolvedIssues`. Every unresolved `*_conflict` issue is counted once, including questionnaire and source disagreements; claims already linked to a conflict issue are not double-counted.

The builder API also accepts `supportingSources` for `linkedin`, `github`, `feedback`, or `manual` evidence. A source may include explicit `claims`, each with an existing candidate `contextId`, `claim`, optional `skills`, and optional `conflictsWith` (a claim ID or exact existing claim wording). Equal wording adds corroborating provenance; an explicit disagreement becomes a blocking `source_claim_conflict`. The builder never guesses a role context or treats merely similar wording as a conflict.

When the validated resume has JSON Resume `projects[]`, each project becomes its own evidence context. Its description and highlights retain `projects[...]` provenance and never share skills or facts with another project. A project is linked to a role only when its `entity` matches exactly one employer context; otherwise the project remains independently scoped instead of being guessed into a role.

For a guided `projects` question, submit structured project data (`projects: [{ name, facts?, skills? }]`) rather than free text. Each named project becomes a child context of that role, and its questionnaire facts remain pending until reviewed. An unknown answer creates neither a project nor a claim.

Safe lexical normalization is limited to explicit aliases such as `NodeJS` → `Node.js`, `Postgres` → `PostgreSQL`, and `CI CD` → `CI/CD`. Candidate evidence always preserves the original wording separately. The builder does not turn related terminology into a stronger claim — for example, it never changes “multiple backend services” into “microservices”.

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

## Documentation & User Manual

For detailed guides and architecture documentation, refer to:
- **[User Manual](docs/user-manual.md)**: Complete step-by-step instructions for using the CV Tailor web workspace.
- **[Web Workspace Architecture](docs/web-workspace-architecture.md)**: Technical overview of the single-page application structure, modular ES6 architecture, and pipeline stages.
- **[Full Documentation Hub](docs/)**: Explore additional guides on job extraction, schema contracts, Gemini providers, and preprocessing.

## Project structure

```text
cv-tailor/
├── cv-tailor.config.json      # Centralized pipeline and provider configuration
├── server.mjs                 # Full-stack Express server entry point (Port 3000)
│
├── public/                    # Web UI client-side application
│   ├── index.html             # Responsive semantic HTML5 single-page application
│   ├── app.js                 # Vanilla ES6+ reactive controller, SSE client & diff engine
│   └── styles.css             # Tailwind utilities, accessible touch targets & diff styling
│
├── server/                    # Backend REST API and process orchestration
│   ├── app.mjs                # Express app configuration & static asset serving
│   ├── routes/                # REST endpoints (jobs, pipeline, artifacts, evidence, config, doctor)
│   ├── services/              # Job parser, evidence, pipeline runner & render services
│   └── process/               # Background task execution & Server-Sent Events (SSE) log stream
│
├── data/
│   ├── resumes/
│   │   └── base.json          # Master resume in JSON Resume format
│   ├── jobs/
│   │   └── example-job.json   # Parsed target job descriptions
│   ├── aliases.json           # Tech and skill alias mapping
│   └── evidence.json          # Factual career evidence repository
│
├── config/
│   ├── schema.mjs             # Zod configuration schema & validation
│   └── load-config.mjs        # Config loader with root path resolution
│
├── lib/
│   ├── doctor/
│   │   └── diagnostics.mjs    # Testable readiness checks and exit status
│   └── render/
│       ├── arguments.mjs      # Renderer command-line contract
│       └── browser.mjs        # Portable browser detection and validation
│
├── scripts/
│   ├── analyse.mjs            # Stage 1: Requirement matching vs evidence
│   ├── tailor.mjs             # Stage 2: Factual bullet selection
│   ├── llm.mjs                # Multi-provider LLM adapter (Strategy pattern)
│   ├── rewrite.mjs            # Stage 3: Controlled LLM bullet rewriting
│   ├── summary.mjs            # Stage 4: Tailored summary generation
│   ├── final-check.mjs        # Stage 5: Factual integrity and anti-hallucination audit
│   ├── render.mjs             # Stage 6: Dynamic JSON Resume renderer & PDF generator
│   ├── doctor.mjs             # Local setup and readiness diagnostic CLI
│   ├── validate.mjs           # JSON Resume schema validation
│   └── run.mjs                # Main CLI pipeline orchestrator
│
├── docs/
│   ├── setup.md               # Installation and troubleshooting guide
│   └── job-parser-providers.md# Semantic job parser configuration
│
├── output/                    # Company-specific pipeline artifacts and PDFs
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

### Import an existing resume

Use the local, deterministic resume parser to create a reviewable JSON Resume
candidate from TXT, Markdown, or a text-based PDF:

```bash
npm run resume:parse -- \
  --input resume.md \
  --output data/resumes/imported.json
```

The parser writes a separate `imported.json.report.json` file. Review that
report before promoting the candidate to `base.json`; the parser never replaces
the master resume automatically. Text-based PDFs are also supported when
Poppler's `pdftotext` is installed. Scanned PDFs require OCR and are rejected
instead of guessed.

The report keeps JSON Pointer provenance and review issues separate from the
clean JSON Resume candidate. Dates retain their source precision, metrics and
wording are copied without enrichment, and unsupported or ambiguous facts are
omitted for review. Candidate/report publication is transactional and the
configured `paths.baseResume` is protected. Arbitrary or near-empty input fails
with `RESUME_MALFORMED_INPUT`; any candidate value that cannot be traced back to
its source fails with `RESUME_GROUNDING_FAILED`.

For architecture, supported extraction conventions, structured errors,
limitations, and the review workflow, see
[Resume parser](docs/resume-parser.md). The external dependency and prior-art
decisions are recorded in the
[resume parser implementation assessment](docs/resume-parser-assessment.md).

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

Create a structured job file from a text description with:

```bash
node scripts/job-parser.mjs job-description.txt
```

For long Ollama jobs, enable resumable batches with `--checkpoint output/job.checkpoint.json`.

Use `--semantic-provider gemini`, `--semantic-provider ollama`, or
`--semantic-provider none` to override semantic extraction for one run.

---

## Web UI & Interactive Studio

CV Tailor includes a full-stack, local-first web application that provides an interactive graphical interface for the entire tailoring pipeline, career evidence management, live artifact auditing, and environment diagnostics.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ CV TAILOR STUDIO                     [Workspace] [Evidence] [History] [Settings] [●Ready]│
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Ingest Job ─► 2. Review ─► 3. Match Analysis ─► 4. Run CI/CD ─► 5. Preview & Export   │
│                                                                                         │
│  [ Paste Raw Description / Select Job ]                                                 │
│  ├── Metadata & Category Columns (Core / Preferred / Competencies)                      │
│  ├── Evidence Compatibility Scorecards & Grounding Matrix Filters                       │
│  ├── Live CI/CD Stage Flow Nodes (Analyse → Tailor → Rewrite → Summary → Audit → Render)│
│  └── Side-by-Side Diff Viewer (base.json vs resume-final.json) & Live PDF / HTML Preview│
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Architecture & Tech Stack

The web interface is engineered with a clean, decoupled, zero-build-step architecture prioritizing developer ergonomics, execution speed, and absolute data privacy:

#### Frontend
- **Single Page Application (SPA)**: Written in vanilla modular ES6+ JavaScript (`public/app.js`), requiring no compilation or bundling step for instant reloads, predictable debugging, and effortless inspection.
- **Layout & Structure**: Semantic HTML5 (`public/index.html`) featuring accessible ARIA landmarks, dialog modals with backdrop dismissal, keyboard shortcuts, and responsive containers.
- **Styling & Design System**: Modern [Tailwind CSS](https://tailwindcss.com/) paired with custom utility tokens (`public/styles.css`). Uses a refined **Slate** neutral palette (`#0f172a`, `#1e293b`, `#e2e8f0`) intentionally free of saturated or clashing accent colors (such as purple/indigo).
- **Iconography**: Crisp SVG vector icons powered by [Lucide Icons](https://lucide.dev/).
- **Visual Diff Engine**: Client-side semantic line-by-line diffing powered by [JsDiff](https://github.com/kpdecker/jsdiff) for comparing the master resume against tailored output.
- **Real-Time Streaming**: Server-Sent Events (SSE) client consuming live stdout/stderr streams from the backend execution runner.

#### Responsive & Screen-Shrink Architecture
The UI is engineered to react fluidly across all screen sizes—from 4K desktop displays down to tablet, mobile, and split-screen browser/iframe windows:
- **Shrink-Safe Flex & Grid Containers**: Incorporates `min-width: 0` on flexbox and grid children to prevent text strings, code snippets, and long file paths from exceeding viewport bounds.
- **Overflow & Word-Wrap Safeguards**: Employs `overflow-wrap: break-word` and `break-all` on path displays (`output/<company-slug>/`, URLs, and file identifiers) to eliminate horizontal blowout.
- **Dynamic Touch-Friendly Navigation**: The top header navigation and 5-stage pipeline step bar automatically transform into horizontal momentum-scrollable tracks with touch-friendly targets (≥40px height on mobile).
- **Viewport-Aware Modals**: Dialog modals (`modal-interview`, `modal-add-experience`, `modal-edit-experience`) feature `max-height: calc(100dvh - 1.5rem)` with internal scrolling and overscroll containment, ensuring forms remain fully accessible even on short landscape screens or mobile keyboards.

#### Backend (Full-Stack Express)
- **Runtime**: Node.js (v22+) running native ES Modules (`server.mjs`, `server/app.mjs`).
- **Web Framework**: Express (v5.2.1) serving the static web client and a clean REST API.
- **Process Management**: Decoupled asynchronous child process runner (`server/process/runner.mjs`) managing execution stages, exit code tracking, and real-time SSE event broadcasting.
- **Modular Service Layer**:
  - `server/services/job-parser-service.mjs`: Wraps deterministic and semantic job parsing.
  - `server/services/evidence-service.mjs`: Manages structured career evidence mutations (CRUD, review queue, and skill indexing).
  - `server/services/pipeline-service.mjs`: Orchestrates the 6-stage tailoring pipeline.
  - `server/services/render-service.mjs`: Generates HTML previews, PDF documents, and plaintext extracts.
  - `server/services/config-service.mjs`: Reads and updates `cv-tailor.config.json` with Zod validation.
- **Local-First Zero Telemetry**: Operates strictly on local files (`data/`, `output/`, and `cv-tailor.config.json`). No resume data, credentials, or prompts are sent to external cloud telemetry services.

---

### Starting the Web UI

Launch the server locally:

```bash
# Start the web UI server (runs on port 3000)
npm start

# Or launch with nodemon / auto-restart during development
npm run dev
```

Open your browser to:

```text
http://localhost:3000
```

---

### How to Use the UI: Step-by-Step Guide

The web application is structured into four primary views, accessible via the top navigation bar:

#### 1. Workspace View (The 5-Stage Stepper)

The Workspace walks you through the resume adaptation process in five focused steps:

##### Stage 1 — Job Ingestion
1. **Input Raw Job Description**: Paste unstructured text from job boards (LinkedIn, Greenhouse, Lever, Workday) into the textarea. The live character counter monitors description length.
2. **Select Parser Provider**:
   - **Deterministic Only (`none`)**: Instant offline regex and keyword extraction (zero external calls).
   - **Google Gemini**: Semantic extraction using Gemini Flash for deep requirement disambiguation.
   - **Ollama**: Local LLM semantic parsing for total offline privacy.
3. **Load Saved Jobs**: Use the dropdown to load an existing job from `data/jobs/` or click "Load Sample Job" to test immediately.
4. **Target Company Name**: Specify company name or leave blank for automatic detection.
5. Click **Parse Job Description** to extract structured requirements and advance to Stage 2.

##### Stage 2 — Review & Curate Structure
1. **Metadata Verification**: Review and adjust the extracted Company Name, Job Title, Employment Type, and Workplace / Remote status.
2. **Three-Column Requirement Categorization**:
   - **Required Core Requirements**: Non-negotiable technical skills and core experience (rose indicator).
   - **Preferred Qualifications**: Nice-to-have technologies, frameworks, and domain expertise (amber indicator).
   - **Engineering Competencies**: Architecture, cross-functional leadership, mentoring, and system design competencies (blue indicator).
3. **Interactive Curation**: Add new requirements via the quick-add buttons, edit existing text directly in the cards, or remove irrelevant noise with the delete button.
4. **JSON Inspection & Persistence**: Toggle "Inspect Raw JSON" to edit the underlying JSON directly and click "Apply JSON Changes", or click "Save Job File" to write changes back to `data/jobs/`.
5. Click **Analyse Compatibility** to proceed to Stage 3.

##### Stage 3 — Compatibility & Evidence Analysis
1. **Compatibility Metrics**:
   - **Overall Evidence Match**: Global percentage of requirements supported by your career record.
   - **Core Requirements Match**: Match percentage across critical mandatory requirements.
   - **Preferred Qualifications Match**: Bonus requirements match.
   - **Competencies Match**: Alignment with engineering leadership and architectural criteria.
2. **Itemized Grounding Matrix**:
   - Interactive filter chips: **All**, **Exact Match** (emerald), **Equivalent / Related** (amber), and **Missing / Gap** (slate).
   - Each requirement card displays the exact supporting facts and projects found in your master resume (`base.json`) and career evidence repository (`evidence.json`).
   - Unmet requirements are clearly marked as unsupported gaps to prevent false claims.
3. **Factual Guardrails Notice**: Summarizes recommended emphasis areas and highlights technologies that must not be added to prevent hallucinations.
4. **Execution Parameters**: Configure resume render theme and toggle LLM bullet rewriting.
5. Click **Execute Tailoring Pipeline** or **Run Full Pipeline** to launch the automated generation workflow.

##### Stage 4 — Pipeline Execution & Live CI/CD Visualizer
1. **Visual Stage Nodes**:
   - Six interactive stage blocks track progress in real time:
     `1. Analyse` → `2. Tailor` → `3. Rewrite` → `4. Summary` → `5. Audit Check` → `6. Render`.
   - Each node displays live status icons (pending clock, active spinner, green check, or red alert) and duration in milliseconds.
2. **Live Streaming Terminal Drawer**:
   - The embedded terminal streams execution logs line-by-line via Server-Sent Events, showing prompt token counts, bullet selection decisions, rewrite acceptance/rejection notices, and anti-hallucination validation checks.
   - Toggle terminal visibility or clear logs on demand.
3. **Stage 5 Fact Check Audit**: Displays automated anti-hallucination pass/fail audit results, factual consistency checks, and any flagged issues.

##### Stage 5 & 6 — Preview, Diff & Export
1. **Live Rendered Document Preview**:
   - Interactive iframe displaying the compiled HTML resume with an "Open in new tab" shortcut for high-fidelity review and printing.
2. **Theme Switcher**:
   - Dynamically toggle between supported themes (`StackOverflow` and `Modern Plain`) with instant re-rendering without re-running previous stages.
3. **Side-by-Side Tailoring Diff**:
   - Switch to the "Side-by-Side Tailoring Diff" tab to compare line-by-line differences between your master resume (`data/resumes/base.json`) and the tailored output (`output/resume-final.json`).
4. **Direct Download Buttons**:
   - **PDF**: Download the ATS-compliant, vector PDF with selectable text.
   - **HTML**: Download the standalone HTML resume file.
   - **TXT**: Download the Poppler-extracted plaintext version for ATS keyword checking.
   - **JSON**: Download the validated JSON Resume format file.

---

#### 2. Evidence Database View (`data/evidence.json`)

The Evidence tab serves as your long-term factual career memory—the ground truth for all resume tailoring:

- **Key Metrics Overview**: Displays verified experience count, documented career facts count, cataloged skills count, and pending review queue items.
- **Candidate Technical Skills & Core Competencies Showcase**:
  - Displays emphasized technical skills organized into domain categories (e.g., *Architecture & Leadership*, *Cloud & Infrastructure*, *Languages & Frameworks*).
  - Each skill badge features an **evidence frequency counter** showing exactly how many career experiences substantiate that skill.
  - **Interactive Filtering**: Clicking any skill badge instantaneously filters the career experience cards below to show only roles demonstrating that skill.
- **Evidence Catalog Cards**:
  - Displays comprehensive cards for each role/project, including company, role title, duration, experience classification, demonstrated skills, and itemized facts.
  - **Edit Experience**: Click the **Edit** button on any card to open the editing modal. Modify company, position, period, type, comma-separated skills, and multi-line facts with validation. Changes persist directly to `data/evidence.json`.
  - **Delete Experience**: Obsolete or duplicate experiences can be deleted directly from the edit modal with safety confirmation.
- **Add Experience**: Click **Add Experience** to insert a new career role with documented facts and skills.
- **Guided Career Interview**:
  - Click **Guided Career Interview** to launch an interactive interview wizard.
  - Prompts you for Company, Project / Initiative, Role Title, Technologies Used, Quantifiable Impact & Metrics, and Architectural Challenges.
  - Formats your answers into structured evidence bullets and automatically appends them to `data/evidence.json` or the review queue.
- **Vetting / Review Queue**: Submit claims for review with one-click approval or rejection workflows.
- **One-Click JSON Export**: Download the entire `evidence.json` database on demand.

---

#### 3. History & Artifacts View

Every tailoring run preserves its outputs under `output/<company-slug>/`. The History tab lets you:

- **Browse Past Runs**: View all historical runs with company name, job title, status badge, output directory, and timestamp.
- **Load in Workspace**: One-click action to load any historical run back into the Workspace preview for inspection.
- **Preview & Download**: Direct links to open HTML previews in a new tab or download previously generated PDFs.
- **Deep Artifact Inspection**: Historical outputs preserve `analysis.json`, `tailoring-plan.json`, `resume-rewritten.json`, `resume-final.json`, and `final-check.json`.

---

#### 4. Settings & Diagnostics View

The Settings tab provides a graphical editor for `cv-tailor.config.json` and interactive environment health checks:

- **Environment Diagnostics (`doctor`)**:
  - Real-time status badge in the top navigation (**Ready**, **Warnings**, or **Blocked**).
  - Diagnostic runner checking:
    - Node.js version (≥ 22.x).
    - Chrome / Puppeteer browser detection.
    - Poppler utilities (`pdftotext`, `pdfinfo`) availability.
    - Local LLM endpoint availability (Ollama / LocalAI).
    - Environment credentials (`GEMINI_API_KEY`, etc.).
  - Re-run diagnostics on demand.
- **LLM Configuration**:
  - Select active provider: **Google Gemini**, **Ollama (Local)**, **OpenAI**, **Groq**, **Anthropic**, or **Local HTTP Proxy**.
  - Configure Gemini API key with password visibility toggle.
  - Set Ollama model (e.g., `llama3.2`) and host URL (`http://127.0.0.1:11434`).
  - Toggle factual LLM rewriting default on/off.
  - Set maximum bullet points per role.
  - Validates and saves changes directly to `cv-tailor.config.json`.

---

### REST API Reference

The backend Express server provides RESTful endpoints utilized by the web UI and available for automation:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/jobs` | `GET` | List all parsed job description files in `data/jobs/`. |
| `/api/jobs/parse` | `POST` | Ingest raw text and run deterministic or semantic job parsing. |
| `/api/jobs` | `POST` | Save or update a structured job file. |
| `/api/jobs/sample` | `GET` | Retrieve sample job description text for rapid testing. |
| `/api/pipeline/analysis/:jobName` | `GET` | Compute or retrieve requirement-to-evidence match matrix. |
| `/api/pipeline/run` | `POST` | Execute the full pipeline or individual stages. |
| `/api/pipeline/logs` | `GET` | Server-Sent Events (SSE) stream for real-time process logs. |
| `/api/artifacts/runs` | `GET` | List all historical pipeline runs from the `output/` directory. |
| `/api/artifacts/:company/preview` | `GET` | Serve compiled HTML resume for a company run. |
| `/api/artifacts/:company/:file` | `GET` | Fetch intermediate JSON artifacts, reports, or rendered files. |
| `/api/render/preview/:company` | `GET` | Serve compiled HTML resume for live iframe preview. |
| `/api/render/download/:company/:fmt` | `GET` | Download resume artifact (`pdf`, `html`, or `txt`). |
| `/api/evidence/summary` | `GET` | Retrieve evidence statistics (experiences, facts, skills, queue). |
| `/api/evidence/catalog` | `GET` | Search and filter experiences with query and skill parameters. |
| `/api/evidence/experiences` | `POST` | Disabled; submit new claims to the review workflow. |
| `/api/evidence/experiences/:id` | `PUT/DELETE` | Disabled; canonical evidence is immutable outside builder promotion. |
| `/api/evidence/builder` | `GET/POST` | Read or build a reviewable evidence candidate. |
| `/api/evidence/builder/candidate` | `GET` | Download the current candidate artifact. |
| `/api/evidence/builder/report` | `GET` | Download the current audit/report artifact. |
| `/api/evidence/builder/questionnaire` | `POST` | Record questionnaire answers as pending claims/issues. |
| `/api/evidence/builder/review` | `POST` | Apply structured claim or conflict decisions. |
| `/api/evidence/builder/promote` | `POST` | Promote only fully reviewed evidence to canonical storage. |
| `/api/evidence/queue` | `GET` | List items pending review in the evidence queue. |
| `/api/evidence/queue` | `POST` | Submit facts to the review queue from interview or manual input. |
| `/api/evidence/queue/:id/approve` | `POST` | Approve a review queue item and merge into evidence. |
| `/api/evidence/queue/:id/reject` | `POST` | Reject a review queue item. |
| `/api/evidence/export` | `GET` | Export and download full `evidence.json`. |
| `/api/evidence/import` | `POST` | Disabled; imports must enter the Evidence Builder review flow. |
| `/api/config` | `GET` | Read centralized `cv-tailor.config.json`. |
| `/api/config` | `PUT` | Update and validate `cv-tailor.config.json` via Zod schema. |
| `/api/doctor` | `GET` | Run environment readiness checks and return diagnostic status. |

---

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
  "jobParser": {
    "semanticProvider": "none",
    "providers": {
      "gemini": {
        "model": "gemini-3.1-flash-lite"
      },
      "ollama": {
        "model": "granite4.2:3b-q4_K_S",
        "url": "http://127.0.0.1:11434",
        "contextSize": 16384,
        "maxPromptTokens": 10000,
        "responseTokenReserve": 4000
      }
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

For résumé generation, API keys can be declared under `llm.*` in
`cv-tailor.config.json` or supplied through `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `GROQ_API_KEY`. In particular,
`llm.gemini.apiKey` applies to résumé generation. Gemini semantic job parsing
requires `GEMINI_API_KEY` and never reads the résumé-generation key from the
configuration file.

The job parser has an independent semantic-provider setting under
`jobParser.semanticProvider`. Choose `gemini`, `ollama`, or `none`; this does not
change the provider used to rewrite résumé content. `none` permits deterministic
extraction only and fails explicitly if any source block still needs semantic
interpretation. It is the safe default for an unconfigured installation, so a
job description is sent to a model only after you explicitly select `gemini` or
`ollama`. See [Job parser providers](docs/job-parser-providers.md).

Job-parser provider selection uses this exact precedence:

```text
--semantic-provider
    ↓
JOB_PARSER_PROVIDER
    ↓
jobParser.semanticProvider
    ↓
none
```

Ollama job parsing accepts `OLLAMA_MODEL` and `OLLAMA_HOST`, plus the more
specific `JOB_PARSER_OLLAMA_MODEL`, `JOB_PARSER_OLLAMA_HOST`,
`JOB_PARSER_OLLAMA_CONTEXT_SIZE`, `JOB_PARSER_OLLAMA_TIMEOUT_MS`,
`JOB_PARSER_OLLAMA_MAX_PROMPT_TOKENS`,
`JOB_PARSER_OLLAMA_RESPONSE_TOKEN_RESERVE`,
`JOB_PARSER_OLLAMA_MAX_ATTEMPTS`,
`JOB_PARSER_OLLAMA_BATCH_SIZE`, and `JOB_PARSER_OLLAMA_MAX_CORRECTIONS`.
Job-parser-specific variables take precedence over the shared Ollama variables.
Recognized qualification and responsibility headings also protect complete
bullets from silent model exclusion; this bounded fallback is accepted only
after the normal local schema, semantic, and source-evidence checks pass.
Common unmarked headings such as `What You’ll Own`, `What You’ll Bring`, and
`It’s a bonus if you have` are recognized exactly, while team/company headings
end the preceding candidate section to prevent classification leakage.
During Ollama recovery, valid blocks are retained and only invalid blocks are
corrected or subdivided. Partial work is never published as a final job file.

---

## Requirements

The project currently expects:

- Node.js 22+
- npm
- Chrome or Chromium (the browser managed by Puppeteer is detected automatically)
- Poppler (`pdftotext` and `pdfinfo`)
- Ollama for optional local rewriting or semantic job parsing

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

Run the local readiness diagnostic before processing résumé data:

```bash
npm run doctor
```

The diagnostic does not read résumé files, contact model services, or display
credentials. `READY` exits with code 0, `READY-WITH-WARNINGS` exits with code 2
when only optional capabilities are absent, and `BLOCKED` exits with code 1.
Use `npm run doctor -- --json` for machine-readable output. See
[Local setup and troubleshooting](docs/setup.md) for corrective actions.

Install Poppler on macOS:

```bash
brew install poppler
```

On Debian/Ubuntu, use `sudo apt install poppler-utils`. Other platforms should
install a package that provides both `pdftotext` and `pdfinfo` on `PATH`.

Puppeteer's managed browser is used by default. To select another Chrome or
Chromium executable, set `render.browserExecutable` in the configuration file or
set `PUPPETEER_EXECUTABLE_PATH`; the environment variable takes precedence.
Explicit overrides must point to an executable file; an invalid override fails
instead of silently selecting a different browser.

If using the local LLM rewriting stage, install Ollama and pull the configured model.

Example:

```bash
ollama pull granite4.2:3b-q4_K_S
```

## Running the pipeline

You can run the pipeline either through the **Interactive Web UI** or via the **Command Line Interface (CLI)**:

### Option A: Using the Interactive Web UI (Recommended)

Start the full-stack local server:

```bash
npm start
```

Open `http://localhost:3000` in your browser. You can paste any job description, curate parsed requirements, inspect matching evidence, execute the 6-stage pipeline with real-time streaming logs, and inspect live HTML previews alongside side-by-side diffs against your master resume. Each web run has a stable run ID and records structured stage start, completion, failure, duration, artifact, and child-process-output events in addition to the readable terminal log.

### Option B: Using the CLI

Run the complete tailoring pipeline for a job file directly in your terminal:

```bash
node scripts/run.mjs data/jobs/example-job.json
```

Render a résumé beside its JSON input, optionally selecting a theme:

```bash
node scripts/render.mjs output/flash/resume-final.json
node scripts/render.mjs output/flash/resume-final.json jsonresume-theme-stackoverflow
```

Use `--output-dir` to place `resume.html`, `resume.pdf`, and `resume.txt` in a
different directory:

```bash
node scripts/render.mjs data/resumes/base.json --output-dir output
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
- older career roles may not yet have detailed evidence.

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
- [x] Local Web UI & interactive studio (implemented);
- interactive career interview mode (implemented in UI).

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
