# CV Tailor Web Workspace Architecture & Page Overview

## Overview
The CV Tailor web application provides a responsive, single-page interface for managing job descriptions, reviewing structured requirements, running AI-assisted and deterministic compatibility analysis, executing the 5-stage tailoring pipeline with real-time Server-Sent Events (SSE) streaming logs, and previewing/diffing generated resume artifacts.

---

## Page Structure & Stages

### 1. Stage 1: Job Description Ingestion
- **Purpose**: Input raw job posting text or select a pre-parsed saved job from `data/jobs/`.
- **Features**:
  - Raw textarea with live character count.
  - Target company slug auto-detection / override input.
  - Sample job loading (`btn-load-sample`).
  - Workspace reset (`btn-reset-workspace`) to clear inputs and reset state.

### 2. Stage 2: Parsed Job Structure Review
- **Purpose**: Inspect and curate parsed requirements (Core/Required, Preferred, Engineering Competencies).
- **Features**:
  - Direct JSON editor inspection mode toggle (`btn-toggle-raw-json`).
  - Add, edit, or remove requirement items across categories.
  - Save curated job updates (`btn-save-job-changes`).
  - Proceed to Compatibility Analysis (`btn-proceed-analyse`).

### 3. Stage 3: Evidence Compatibility Matrix
- **Purpose**: Automated factual evaluation of candidate master evidence vs. target job requirements.
- **Features**:
  - Live compatibility score breakdown.
  - Gap analysis highlighting missing or unsupported skills.

### 4. Stage 4: CI/CD Pipeline Execution
- **Purpose**: Run the multi-stage tailoring pipeline (`analyse`, `tailor`, `rewrite`, `summary`, `finalCheck`, `render`) with real-time progress tracking.
- **Features**:
  - Real-time Server-Sent Events (SSE) terminal streaming output.
  - Pipeline node status indicators (pending, running, success, skipped, warning).
  - Structured `pipeline_event` messages containing a run ID, stage, timestamp,
    duration, artifact name, and normalized failure code. `process.output` events
    attribute child-process output to its originating stage without recording
    configuration secrets or full source payloads.

### 5. Stage 5: Artifacts, Preview & Dynamic Theme Switcher
- **Purpose**: Preview generated resume HTML, PDF, and text artifacts with side-by-side diffing against the base master resume.
- **Features**:
  - Live iframe preview (`resume-preview-frame`).
  - Dynamic theme switcher supporting 10+ JSON Resume themes.
  - Side-by-side diff inspector (`btn-toggle-diff`).
  - One-click PDF download.

---

## Frontend Modular Architecture
Following clean architecture principles, the client-side code is organized into modular ES6 files:
- `public/app.js`: Main UI controller and event orchestrator.
- `public/js/constants.js`: Centralized UI selectors, pipeline stages, and step mappings.
- `public/js/state.js`: Global state container and state mutation helpers.
- `public/js/api.js`: Robust REST API fetch wrappers with error handling.
- `public/js/notifications.js`: Parser alert banners and terminal logger service.
