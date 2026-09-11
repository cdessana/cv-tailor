# CV Tailor User Manual

Welcome to **CV Tailor**, a local-first, factual resume tailoring tool designed to adapt your master resume to specific job descriptions without fabricating experience or inflating claims.

---

## Getting Started

1. **Launch the Application**: Open the web application in your browser.
2. **Dashboard Overview**: The interface is structured around a 5-step interactive pipeline workspace:
   - **Step 1: Job Ingestion**
   - **Step 2: Structure Review**
   - **Step 3: Compatibility Analysis**
   - **Step 4: Pipeline Execution**
   - **Step 5: Preview & Diff**

---

## Step-by-Step Workflow

### Step 1: Ingest a Job Description
- **Option A**: Paste a raw job posting into the text area. The system will auto-detect the company name and job title.
- **Option B**: Choose a pre-parsed sample job from the **Load saved** dropdown or click **Load Sample Job**.
- Click **Parse Job Description** to advance to Stage 2.

### Step 2: Review & Curate Job Structure
- Inspect the parsed requirements broken down into **Core / Required**, **Preferred Qualifications**, and **Engineering Competencies**.
- You can add, edit, or delete items, or inspect/edit the raw JSON directly using the **Inspect Raw JSON** button.
- Click **Save Job File** to store changes, then **Analyse Compatibility**.

### Step 3: View Compatibility Matrix
- Review how well your master resume and career evidence match the job requirements.
- Identify supported skills vs. capability gaps.

### Step 4: Execute the Tailoring Pipeline
- Click **Run Full Pipeline** to execute the 5-stage tailoring engine.
- Watch real-time build logs stream into the terminal output box.
- The pipeline analyzes requirements, selects relevant career evidence, rewrites bullet points safely (without inventing facts), runs final audits, and renders the ATS-friendly resume.

### Step 5: Preview, Diff & Export
- View the generated resume live in the interactive iframe preview.
- Switch themes instantly using the theme selector.
- Use **Toggle Diff View** to inspect side-by-side changes against your master resume (`base.json`).
- Download the final PDF or open the HTML preview in a new tab.

---

## Settings & Configuration
- Navigate to the **Settings** view to configure LLM providers (Gemini API key, Ollama endpoint, or `none` for deterministic-only parsing).
- Check system health and diagnostics using the Doctor status badge in the top navigation bar.
