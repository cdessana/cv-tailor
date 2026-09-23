import { evidenceBuilderApi } from "./evidence-builder-api.js";

// CV Tailor — Application Client (Senior Design Upgrade)

(function () {
  "use strict";

  // Application State
  const state = {
    currentView: "home",
    currentJob: null,
    currentJobPath: null,
    currentAnalysis: null,
    currentRun: null,
    jobParseInFlight: false,
    currentTheme: "jsonresume-theme-stackoverflow",
    activeEvidenceFilter: "all",
    activeEvidenceSkill: "",
    activeEvidenceType: "",
    catalogExperiences: [],
    catalogSkills: {},
    catalogBaseSkills: [],
    catalogSkillFrequencies: {},
    doctorReport: null,
    doctorCheckInFlight: false,
    config: null,
    evidenceSummary: null,
  };
  let jobParseAbortController = null;
  let pipelineAbortController = null;

  // DOM Elements Helper
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  // Initialize Application
  async function init() {
    setupNavigation();
    setupWorkspaceStepNav();
    setupWorkspaceEvents();
    setupEvidenceEvents();
    setupSettingsEvents();
    setupHistoryEvents();
    setupModalKeyEvents();

    if (window.lucide) {
      lucide.createIcons();
    }

    // Load initial config, diagnostics, and saved state
    await Promise.all([
      fetchDoctorStatus(),
      fetchConfig(),
      fetchSavedJobs(),
      fetchEvidenceSummary(),
      loadLinkedInImportHistory(),
    ]);
  }

  // -------------------------------------------------------------
  // Navigation & View Toggling
  // -------------------------------------------------------------
  function setupNavigation() {
    const views = {
      home: $("#view-home"),
      workspace: $("#view-workspace"),
      evidence: $("#view-evidence"),
      history: $("#view-history"),
      settings: $("#view-settings"),
    };

    const navTabs = {
      home: $("#nav-home"),
      workspace: $("#nav-workspace"),
      evidence: $("#nav-evidence"),
      history: $("#nav-history"),
      settings: $("#nav-settings"),
    };

    function switchView(target) {
      state.currentView = target;
      for (const [key, el] of Object.entries(views)) {
        if (!el) continue;
        if (key === target) {
          el.classList.remove("hidden");
        } else {
          el.classList.add("hidden");
        }
      }

      for (const [key, tab] of Object.entries(navTabs)) {
        if (!tab) continue;
        if (key === target) {
          tab.className = "nav-tab active px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap";
        } else {
          tab.className = "nav-tab px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors text-slate-600 hover:text-slate-900 hover:bg-slate-100 whitespace-nowrap";
        }
      }

      if (target === "evidence") {
        loadEvidenceCatalog();
        refreshEvidenceReviewAvailability();
      }
      if (target === "history") loadHistoryRuns();
      if (target === "settings") loadSettingsForm();

      if (window.lucide) lucide.createIcons();
    }

    $("#nav-workspace")?.addEventListener("click", () => switchView("workspace"));
    $("#nav-home")?.addEventListener("click", () => switchView("home"));
    $("#nav-evidence")?.addEventListener("click", () => switchView("evidence"));
    $("#nav-history")?.addEventListener("click", () => switchView("history"));
    $("#nav-settings")?.addEventListener("click", () => switchView("settings"));
    $("#btn-home-career")?.addEventListener("click", () => switchView("evidence"));
    $("#home-primary-action")?.addEventListener("click", (event) => {
      const target = event.target.closest("[data-home-view]")?.dataset.homeView;
      if (target) switchView(target);
    });

    // Doctor modal triggers
    $$(".btn-doctor-trigger").forEach((button) => {
      button.addEventListener("click", () => refreshDoctorStatus({ openModal: true }));
    });
    $("#btn-close-doctor-modal")?.addEventListener("click", closeDoctorModal);
    $("#btn-modal-rerun-doctor")?.addEventListener("click", () => refreshDoctorStatus({ openModal: true }));
  }

  function renderHome() {
    const summary = state.evidenceSummary;
    const action = $("#home-primary-action");
    const copy = $("#home-progress-copy");
    const steps = $("#home-progress-steps");
    if (!summary || !action || !copy || !steps) return;
    const roles = summary.careerRolesCount ?? summary.experiencesCount ?? 0;
    const details = summary.factsCount ?? 0;
    const readyForTailoring = roles > 0;
    action.innerHTML = readyForTailoring
      ? `<button type="button" data-home-view="workspace" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold"><i data-lucide="file-pen-line" class="w-4 h-4"></i>Tailor a CV</button>`
      : `<button type="button" data-home-view="evidence" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold"><i data-lucide="upload" class="w-4 h-4"></i>Import your resume</button>`;
    copy.textContent = readyForTailoring
      ? `${roles} career role${roles === 1 ? "" : "s"} saved. You can tailor a CV now, or add more detail to improve future results.`
      : "Start by importing a resume or LinkedIn PDF to create your reusable Career Profile.";
    const progress = [
      { label: "Career Profile", detail: roles ? `${roles} roles added` : "Not started", complete: roles > 0 },
      { label: "Career details", detail: details ? `${details} confirmed details` : "Add details to strengthen your profile", complete: details > 0 },
      { label: "Tailored CV", detail: "Add a job description when you are ready", complete: Boolean(state.currentRun) },
    ];
    steps.innerHTML = progress.map((item) => `<div class="rounded-lg border ${item.complete ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"} p-3"><p class="text-xs font-bold ${item.complete ? "text-emerald-900" : "text-slate-800"}">${item.complete ? "✓ " : "○ "}${item.label}</p><p class="text-[11px] ${item.complete ? "text-emerald-800" : "text-slate-500"} mt-1">${item.detail}</p></div>`).join("");
    if (window.lucide) lucide.createIcons();
  }

  // -------------------------------------------------------------
  // Interactive Step Navigation Bar
  // -------------------------------------------------------------
  function setupWorkspaceStepNav() {
    const stepStages = {
      1: "stage-job-input",
      2: "stage-job-review",
      3: "stage-job-analysis",
      4: "stage-pipeline-exec",
      5: "stage-preview-artifacts",
    };

    $$("#workspace-step-nav .step-badge").forEach((badge) => {
      badge.addEventListener("click", () => {
        const step = Number.parseInt(badge.getAttribute("data-step"), 10);
        const stageId = stepStages[step];
        const stageEl = $(`#${stageId}`);

        if (stageEl && !stageEl.classList.contains("hidden")) {
          stageEl.scrollIntoView({ behavior: "smooth", block: "start" });
          updateStepIndicators(step);
        } else if (step === 1) {
          $(`#${stepStages[1]}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          updateStepIndicators(1);
        }

        for (let i = step + 1; i <= 5; i++) {
          $(`#${stepStages[i]}`)?.classList.add("hidden");
        }
      });
    });
  }

  // -------------------------------------------------------------
  // Doctor Diagnostics
  // -------------------------------------------------------------
  async function fetchDoctorStatus() {
    try {
      const res = await fetch("/api/doctor");
      const report = await res.json();
      state.doctorReport = report;
      updateDoctorBadge(report);
      return report;
    } catch (err) {
      console.error("Doctor fetch error:", err);
      updateDoctorBadge({ status: "error" });
    }
  }

  async function refreshDoctorStatus({ openModal = false } = {}) {
    if (openModal) {
      $("#modal-doctor-details")?.classList.remove("hidden");
    }
    if (state.doctorCheckInFlight) return;

    state.doctorCheckInFlight = true;
    setDoctorLoadingState(true);
    renderDoctorModal();
    loadSettingsDoctorSection();

    try {
      await fetchDoctorStatus();
    } finally {
      state.doctorCheckInFlight = false;
      setDoctorLoadingState(false);
      if (state.doctorReport) updateDoctorBadge(state.doctorReport);
      renderDoctorModal();
      loadSettingsDoctorSection();
    }
  }

  function setDoctorLoadingState(isLoading) {
    for (const button of [
      ...$$(".btn-doctor-trigger"),
      $("#btn-modal-rerun-doctor"),
      $("#btn-rerun-doctor"),
    ].filter(Boolean)) {
      const label = button.querySelector("span:last-child");
      if (isLoading) {
        button.dataset.originalLabel = label?.textContent || button.textContent.trim();
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.classList.add("opacity-60", "cursor-wait");
        if (label) label.textContent = "Checking...";
        else button.textContent = "Checking...";
      } else {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.classList.remove("opacity-60", "cursor-wait");
        const originalLabel = button.dataset.originalLabel;
        if (originalLabel) {
          if (label) label.textContent = originalLabel;
          else button.textContent = originalLabel;
        }
      }
    }
  }

  function updateDoctorBadge(report) {
    const status = report.status === "pass" || report.status === "ready"
      ? { text: "Env: Ready", dot: "bg-emerald-500", surface: ["bg-emerald-50", "text-emerald-800", "border-emerald-300"] }
      : report.status === "warn" || report.status === "ready_with_warnings" || report.status === "ready-with-warnings"
      ? { text: "Env: Ready (Warnings)", dot: "bg-amber-500", surface: ["bg-amber-50", "text-amber-800", "border-amber-300"] }
      : { text: "Env: Blocked", dot: "bg-rose-500", surface: ["bg-rose-50", "text-rose-800", "border-rose-300"] };

    for (const button of $$(".btn-doctor-trigger")) {
      const dot = button.querySelector(".doctor-status-dot");
      const text = button.querySelector(".doctor-status-text");
      dot?.classList.remove("bg-slate-400", "bg-emerald-500", "bg-amber-500", "bg-rose-500");
      dot?.classList.add(status.dot);
      if (text) text.textContent = status.text;
      button.classList.remove("bg-slate-100", "bg-emerald-50", "bg-amber-50", "bg-rose-50", "text-slate-700", "text-emerald-800", "text-amber-800", "text-rose-800", "border-slate-300", "border-emerald-300", "border-amber-300", "border-rose-300");
      button.classList.add(...status.surface);
    }
  }

  function openDoctorModal() {
    renderDoctorModal();
    $("#modal-doctor-details")?.classList.remove("hidden");
  }

  function closeDoctorModal() {
    $("#modal-doctor-details")?.classList.add("hidden");
  }

  function renderDoctorModal() {
    const container = $("#doctor-modal-checks");
    if (!container) return;

    if (state.doctorCheckInFlight) {
      container.innerHTML = `<div class="text-xs text-slate-500 p-4 text-center" role="status" aria-live="polite">Checking environment diagnostics...</div>`;
      return;
    }

    if (!state.doctorReport || !state.doctorReport.checks) {
      container.innerHTML = `<div class="text-xs text-slate-500 p-4 text-center">No diagnostic checks available.</div>`;
      return;
    }

    container.innerHTML = state.doctorReport.checks
      .map((c) => {
        const isPass = c.status === "pass";
        const isWarn = c.status === "warn";
        const badgeClass = isPass
          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
          : isWarn
          ? "bg-amber-100 text-amber-800 border-amber-200"
          : "bg-rose-100 text-rose-800 border-rose-200";

        const icon = isPass ? "check-circle" : isWarn ? "alert-triangle" : "alert-circle";

        return `
          <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-start justify-between gap-3 text-xs">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-bold text-slate-900">${escapeHtml(c.label)}</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border ${badgeClass}">${c.status}</span>
              </div>
              <p class="text-slate-600 leading-relaxed">${escapeHtml(c.message)}</p>
              ${c.action ? `<p class="text-amber-800 font-medium text-[11px] pt-0.5">Recommended: ${escapeHtml(c.action)}</p>` : ""}
            </div>
            <i data-lucide="${icon}" class="w-4 h-4 shrink-0 mt-0.5 ${isPass ? "text-emerald-600" : isWarn ? "text-amber-600" : "text-rose-600"}"></i>
          </div>
        `;
      })
      .join("");

    if (window.lucide) lucide.createIcons();
  }

  // -------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------
  async function fetchConfig() {
    try {
      const res = await fetch("/api/config");
      state.config = await res.json();
      return state.config;
    } catch (err) {
      console.error("Config fetch error:", err);
    }
  }

  // -------------------------------------------------------------
  // Stage 1: Job Ingestion & Saved Jobs
  // -------------------------------------------------------------
  async function fetchSavedJobs() {
    try {
      const res = await fetch("/api/jobs");
      const jobs = await res.json();
      const select = $("#select-existing-job");
      if (!select) return;

      select.innerHTML = `<option value="">-- Choose saved job --</option>`;

      for (const j of jobs) {
        const opt = document.createElement("option");
        opt.value = j.filename;
        opt.textContent = `${j.company} — ${j.title} (${j.filename})`;
        select.appendChild(opt);
      }
    } catch (err) {
      console.error("Error loading saved jobs:", err);
    }
  }

  function setupWorkspaceEvents() {
    const rawTextarea = $("#job-raw-text");
    const charCount = $("#char-count");

    if (rawTextarea && charCount) {
      rawTextarea.addEventListener("input", () => {
        charCount.textContent = `${rawTextarea.value.length} characters`;
      });
    }

    // Clear raw text button
    $("#btn-clear-raw-text")?.addEventListener("click", () => {
      if (rawTextarea) {
        rawTextarea.value = "";
        charCount.textContent = "0 characters";
        rawTextarea.focus();
      }
    });

    // Privacy notice update when semantic provider changes
    $("#select-semantic-provider")?.addEventListener("change", (e) => {
      const prov = e.target.value;
      const notice = $("#parser-privacy-notice");
      if (!notice) return;

      if (prov === "none") {
        notice.innerHTML = `<strong>Local mode:</strong> No job data leaves this machine. Deterministic parsing is used, and ambiguous content may be left for review instead of being inferred.`;
      } else if (prov === "gemini") {
        notice.innerHTML = `<strong>Cloud Gemini mode:</strong> Job text is semantically parsed using Gemini models server-side. Requires configured API key.`;
      } else if (prov === "ollama") {
        notice.innerHTML = `<strong>Local Ollama mode:</strong> Semantic parsing runs via your locally installed Ollama instance. No cloud data transfer.`;
      }
    });

    // Open File Button (Option to load a local .json or .txt file)
    const fileLoader = $("#input-file-loader");
    $("#btn-open-file")?.addEventListener("click", () => {
      if (state.jobParseInFlight) return;
      fileLoader?.click();
    });

    fileLoader?.addEventListener("change", (e) => {
      if (state.jobParseInFlight) return;
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        if (file.name.endsWith(".json")) {
          try {
            const parsed = JSON.parse(content);
            const jobData = parsed.job || parsed; // support both envelope format and raw job format
            loadJobIntoReview(jobData, file.name);
            showToast(`Loaded parsed job from ${file.name}`);
          } catch (err) {
            alert(`Failed to parse JSON file: ${err.message}`);
          }
        } else {
          // It's a text file, put in Stage 1 raw description textarea
          if (rawTextarea) {
            rawTextarea.value = content;
            charCount.textContent = `${content.length} characters`;
            showToast(`Loaded raw job description from ${file.name}`);
          }
        }
      };
      reader.readAsText(file);
      // Reset value to allow uploading the same file again if needed
      e.target.value = "";
    });

    // Select Existing Job from Dropdown
    $("#select-existing-job")?.addEventListener("change", async (e) => {
      if (state.jobParseInFlight) return;
      const filename = e.target.value;
      if (!filename) return;

      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(filename)}`);
        if (!res.ok) throw new Error("Could not load job file.");
        const data = await res.json();
        loadJobIntoReview(data.job, data.path);
      } catch (err) {
        showParserAlert(`Error loading job: ${err.message}`, "error");
      }
    });

    // Parse Job Button
    $("#btn-parse-job")?.addEventListener("click", async () => {
      const rawText = rawTextarea?.value.trim();
      if (!rawText) {
        showParserAlert("Please paste a job description text first.", "warning");
        rawTextarea?.focus();
        return;
      }

      resetWorkspaceState({ preserveInput: true, preserveProvider: true, preserveTargetCompany: true });
      setJobParseInFlight(true);
      const parseAbortController = new AbortController();
      jobParseAbortController = parseAbortController;

      try {
        const res = await fetch("/api/jobs/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rawText,
            semanticProviderName: $("#select-semantic-provider").value,
            customFilename: $("#input-target-company").value.trim() || undefined,
          }),
          signal: parseAbortController.signal,
        });

        const data = await res.json();
        if (!res.ok) {
          if (data.needsSemanticProvider) {
            showParserAlert(
              `<strong>Additional parsing support is needed:</strong> Select <em>Gemini</em> or <em>Ollama</em> and try again, or curate the job manually.`,
              "warning"
            );
          } else {
            showParserAlert(`Parse failed: ${data.error}`, "error");
          }
          return;
        }

        loadJobIntoReview(data.job, data.outputPath);
        await fetchSavedJobs();
      } catch (err) {
        if (err.name !== "AbortError") showParserAlert(`Network error while parsing: ${err.message}`, "error");
      } finally {
        if (jobParseAbortController === parseAbortController) {
          jobParseAbortController = null;
          setJobParseInFlight(false);
        }
      }
    });

    // Reset workspace
    $("#btn-reset-workspace")?.addEventListener("click", () => {
      resetWorkspaceState({ preserveProvider: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Setup Review Stage Events
    setupJobReviewEvents();

    // Setup Analysis & Run Events
    setupAnalysisEvents();

    // Setup Preview & Theme Events
    setupPreviewEvents();
  }

  function showParserAlert(message, type = "info") {
    const box = $("#parser-alert");
    if (!box) return;
    box.innerHTML = message;
    box.classList.remove("hidden");
    if (type === "error") {
      box.className = "p-3.5 rounded-lg border text-xs bg-rose-50 text-rose-800 border-rose-200 leading-relaxed";
    } else if (type === "warning") {
      box.className = "p-3.5 rounded-lg border text-xs bg-amber-50 text-amber-900 border-amber-200 leading-relaxed";
    } else {
      box.className = "p-3.5 rounded-lg border text-xs bg-slate-50 text-slate-800 border-slate-200 leading-relaxed";
    }
  }

  function hideParserAlert() {
    $("#parser-alert")?.classList.add("hidden");
  }

  function setJobParseInFlight(isRunning) {
    state.jobParseInFlight = isRunning;
    const parseButton = $("#btn-parse-job");
    if (parseButton) parseButton.disabled = isRunning;
    const parseLabel = $("#btn-parse-text");
    if (parseLabel) parseLabel.textContent = isRunning ? "Parsing Job Description..." : "Parse Job Description";

    ["#btn-open-file", "#select-existing-job"].forEach((selector) => {
      const control = $(selector);
      if (control) control.disabled = isRunning;
    });
    $$(".btn-load-run-to-workspace").forEach((button) => {
      button.disabled = isRunning;
      button.setAttribute("aria-disabled", String(isRunning));
      button.classList.toggle("opacity-50", isRunning);
      button.classList.toggle("cursor-not-allowed", isRunning);
    });
  }

  function clearWorkspaceOutputs() {
    ["#stage-job-review", "#stage-job-analysis", "#stage-pipeline-exec", "#stage-preview-artifacts", "#raw-json-container", "#alternative-requirements-section", "#final-check-audit-card", "#btn-jump-preview"].forEach((selector) => $(selector)?.classList.add("hidden"));
    ["#analysis-items-container", "#final-check-summary-text", "#final-check-issues-list", "#diff-base-content", "#diff-tailored-content"].forEach((selector) => {
      const element = $(selector);
      if (element) element.innerHTML = "";
    });
    const rawJson = $("#raw-job-json-textarea");
    if (rawJson) rawJson.value = "";
    ["#review-job-company", "#review-job-title", "#review-job-type", "#review-job-remote"].forEach((selector) => {
      const input = $(selector);
      if (input) input.value = "";
    });
    ["required", "preferred", "competencies", "alternatives"].forEach((kind) => {
      const count = $(`#count-req-${kind}`);
      if (count) count.textContent = "0";
      const list = $(`#list-req-${kind}`);
      if (list) list.innerHTML = "";
    });
    const terminal = $("#pipeline-log-terminal");
    if (terminal) terminal.innerHTML = '<div class="text-slate-500">[idle] Waiting for pipeline execution...</div>';
    const preview = $("#resume-preview-frame");
    if (preview) preview.src = "about:blank";
    if ($("#preview-url-label")) $("#preview-url-label").textContent = "output/resume.html";
  }

  function resetWorkspaceState({ preserveInput = false, preserveProvider = true, preserveTargetCompany = false } = {}) {
    if (jobParseAbortController) {
      jobParseAbortController.abort();
      jobParseAbortController = null;
    }
    setJobParseInFlight(false);
    if (pipelineAbortController) {
      pipelineAbortController.abort();
      pipelineAbortController = null;
    }
    hideParserAlert();
    clearWorkspaceOutputs();
    state.currentJob = null;
    state.currentJobPath = null;
    state.currentAnalysis = null;
    state.currentRun = null;
    if (!preserveInput) {
      const raw = $("#job-raw-text");
      if (raw) raw.value = "";
      if ($("#char-count")) $("#char-count").textContent = "0 characters";
      if ($("#select-existing-job")) $("#select-existing-job").value = "";
    }
    if (!preserveProvider && $("#select-semantic-provider")) $("#select-semantic-provider").value = "none";
    if (!preserveTargetCompany && $("#input-target-company")) $("#input-target-company").value = "";
    updateStepIndicators(1);
  }

  // -------------------------------------------------------------
  // Stage 2: Job Review & Editing
  // -------------------------------------------------------------
  function loadJobIntoReview(job, jobPath) {
    state.currentJob = job;
    state.currentJobPath = jobPath;

    if ($("#review-job-company")) $("#review-job-company").value = job.company || "";
    if ($("#review-job-title")) $("#review-job-title").value = job.title || "";
    if ($("#review-job-type")) $("#review-job-type").value = job.type || "";
    if ($("#review-job-remote")) $("#review-job-remote").value = job.remote || "";

    // Raw JSON Textarea
    if ($("#raw-job-json-textarea")) {
      $("#raw-job-json-textarea").value = JSON.stringify(job, null, 2);
    }

    renderRequirementsColumns();

    $("#stage-job-review")?.classList.remove("hidden");
    $("#stage-job-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
    updateStepIndicators(2);

    if (window.lucide) lucide.createIcons();
  }

  function renderRequirementsColumns() {
    const job = state.currentJob;
    if (!job) return;

    job.requirements = job.requirements || {};
    const reqs = job.requirements.required || [];
    const prefs = job.requirements.preferred || [];
    const comps = job.requirements.competencies || [];
    const alts = job.alternativeRequirements || [];

    if ($("#count-req-required")) $("#count-req-required").textContent = reqs.length;
    if ($("#count-req-preferred")) $("#count-req-preferred").textContent = prefs.length;
    if ($("#count-req-competencies")) $("#count-req-competencies").textContent = comps.length;
    if ($("#count-req-alternatives")) $("#count-req-alternatives").textContent = alts.length;

    const altSection = $("#alternative-requirements-section");
    if (altSection) {
      if (alts.length > 0) {
        altSection.classList.remove("hidden");
      } else {
        altSection.classList.add("hidden");
      }
    }

    renderRequirementList($("#list-req-required"), reqs, "required");
    renderRequirementList($("#list-req-preferred"), prefs, "preferred");
    renderRequirementList($("#list-req-competencies"), comps, "competencies");
    renderAlternativesList($("#list-req-alternatives"), alts);
  }

  function renderAlternativesList(container, items) {
    if (!container) return;
    container.innerHTML = "";
    if (!items || !items.length) {
      return;
    }

    items.forEach((item, index) => {
      const optionsText = item.values.join(" OR ");
      const row = document.createElement("div");
      row.className = "bg-white p-3 rounded-lg border border-slate-200 text-xs text-slate-800 flex flex-col justify-between gap-2 shadow-2xs hover:border-indigo-200 transition-colors";

      row.innerHTML = `
        <div class="space-y-1.5 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700 tracking-wider">Choice</span>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-600 tracking-wider">${escapeHtml(item.classification)}</span>
          </div>
          <p class="font-bold text-slate-900 select-text text-sm">${escapeHtml(optionsText)}</p>
          <p class="text-[11px] text-slate-400 italic font-normal leading-relaxed select-text">Context: "${escapeHtml(item.context)}"</p>
        </div>
        <div class="flex items-center justify-end gap-1 shrink-0 border-t border-slate-100 pt-2 mt-1">
          <button class="btn-del-alt text-slate-400 hover:text-rose-600 p-1.5 rounded hover:bg-slate-50 text-[11px] font-semibold flex items-center gap-1" data-index="${index}" title="Remove alternative">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            <span>Remove Choice</span>
          </button>
        </div>
      `;
      container.appendChild(row);
    });

    // Delete handler
    container.querySelectorAll(".btn-del-alt").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.currentTarget;
        const idx = Number.parseInt(target.getAttribute("data-index"), 10);
        state.currentJob.alternativeRequirements.splice(idx, 1);
        renderRequirementsColumns();
        if ($("#raw-job-json-textarea")) {
          $("#raw-job-json-textarea").value = JSON.stringify(state.currentJob, null, 2);
        }
      });
    });

    if (window.lucide) lucide.createIcons();
  }

  function renderRequirementList(container, items, category) {
    if (!container) return;
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = `<div class="text-[11px] text-slate-400 italic p-3 text-center bg-white rounded border border-slate-100">No items listed. Click below to add.</div>`;
      return;
    }

    items.forEach((item, index) => {
      const text = typeof item === "string" ? item : item.text || item.title || JSON.stringify(item);
      const row = document.createElement("div");
      row.className = "group bg-white p-2.5 rounded border border-slate-200 text-xs text-slate-800 flex items-start justify-between gap-2 shadow-2xs hover:border-slate-300 transition-colors";

      row.innerHTML = `
        <span class="flex-1 leading-relaxed text-req-text font-normal select-text">${escapeHtml(text)}</span>
        <div class="flex items-center gap-1 opacity-70 group-hover:opacity-100 shrink-0">
          <button class="btn-edit-req text-slate-400 hover:text-slate-800 p-1 rounded hover:bg-slate-100" data-category="${category}" data-index="${index}" title="Edit requirement">
            <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
          </button>
          <button class="btn-del-req text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-slate-100" data-category="${category}" data-index="${index}" title="Remove requirement">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      `;
      container.appendChild(row);
    });

    // Delete handlers
    container.querySelectorAll(".btn-del-req").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.currentTarget;
        const cat = target.getAttribute("data-category");
        const idx = Number.parseInt(target.getAttribute("data-index"), 10);
        state.currentJob.requirements[cat].splice(idx, 1);
        renderRequirementsColumns();
        if ($("#raw-job-json-textarea")) {
          $("#raw-job-json-textarea").value = JSON.stringify(state.currentJob, null, 2);
        }
      });
    });

    // Inline edit handlers
    container.querySelectorAll(".btn-edit-req").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.currentTarget;
        const cat = target.getAttribute("data-category");
        const idx = Number.parseInt(target.getAttribute("data-index"), 10);
        const currentVal = state.currentJob.requirements[cat][idx];
        const currentStr = typeof currentVal === "string" ? currentVal : currentVal.text || "";

        const row = target.closest(".group");

        // Swap to inline input
        row.innerHTML = `
          <div class="flex-1 space-y-1">
            <input type="text" class="input-inline-edit w-full text-xs p-1.5 border border-slate-900 rounded bg-slate-50 focus:outline-none" value="${escapeHtml(currentStr)}" />
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button class="btn-save-inline text-emerald-700 hover:bg-emerald-50 p-1 rounded font-semibold text-[11px]" title="Save">Save</button>
            <button class="btn-cancel-inline text-slate-400 hover:bg-slate-100 p-1 rounded font-semibold text-[11px]" title="Cancel">Cancel</button>
          </div>
        `;

        const input = row.querySelector(".input-inline-edit");
        input.focus();

        row.querySelector(".btn-save-inline").addEventListener("click", () => {
          const newVal = input.value.trim();
          if (newVal) {
            state.currentJob.requirements[cat][idx] = newVal;
          }
          renderRequirementsColumns();
          if ($("#raw-job-json-textarea")) {
            $("#raw-job-json-textarea").value = JSON.stringify(state.currentJob, null, 2);
          }
        });

        row.querySelector(".btn-cancel-inline").addEventListener("click", () => {
          renderRequirementsColumns();
        });

        input.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter") {
            evt.preventDefault();
            row.querySelector(".btn-save-inline").click();
          } else if (evt.key === "Escape") {
            renderRequirementsColumns();
          }
        });
      });
    });

    if (window.lucide) lucide.createIcons();
  }

  function setupJobReviewEvents() {
    // Add item buttons with inline entry
    $("#btn-add-req-required")?.addEventListener("click", () => promptAddRequirement("required", $("#list-req-required")));
    $("#btn-add-req-preferred")?.addEventListener("click", () => promptAddRequirement("preferred", $("#list-req-preferred")));
    $("#btn-add-req-competencies")?.addEventListener("click", () => promptAddRequirement("competencies", $("#list-req-competencies")));

    // Toggle Raw JSON view
    $("#btn-toggle-raw-json")?.addEventListener("click", () => {
      const container = $("#raw-json-container");
      if (!container) return;
      const isHidden = container.classList.contains("hidden");
      if (isHidden) {
        container.classList.remove("hidden");
        $("#toggle-json-text").textContent = "Hide Raw JSON";
      } else {
        container.classList.add("hidden");
        $("#toggle-json-text").textContent = "Inspect Raw JSON";
      }
    });

    // Apply JSON Changes
    $("#btn-apply-raw-json")?.addEventListener("click", () => {
      try {
        const parsed = JSON.parse($("#raw-job-json-textarea").value);
        state.currentJob = parsed;
        renderRequirementsColumns();
        showToast("JSON applied to structure successfully.");
      } catch (err) {
        alert(`Invalid JSON format: ${err.message}`);
      }
    });

    // Save Job Changes
    $("#btn-save-job-changes")?.addEventListener("click", async () => {
      if (!state.currentJob) return;

      // Sync header inputs
      state.currentJob.company = $("#review-job-company").value.trim();
      state.currentJob.title = $("#review-job-title").value.trim();
      state.currentJob.type = $("#review-job-type").value.trim();
      state.currentJob.remote = $("#review-job-remote").value.trim();

      const filename = state.currentJobPath
        ? state.currentJobPath.split("/").pop()
        : null;

      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(filename || "job.json")}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job: state.currentJob }),
        });

        if (!res.ok) throw new Error("Failed to save job file.");
        const result = await res.json();
        state.currentJobPath = result.path;
        showToast(`Job saved successfully to ${result.path}`);
      } catch (err) {
        alert(`Error saving job: ${err.message}`);
      }
    });

    // Proceed to Compatibility Analysis
    $("#btn-proceed-analyse")?.addEventListener("click", () => {
      triggerAnalysis();
    });
  }

  function promptAddRequirement(category, container) {
    if (!container) return;

    // Check if input row already exists
    if (container.querySelector(".add-requirement-row")) return;

    const addRow = document.createElement("div");
    addRow.className = "add-requirement-row bg-slate-100 p-2.5 rounded border border-slate-300 space-y-2 text-xs shadow-xs";
    addRow.innerHTML = `
      <input type="text" class="input-new-req w-full text-xs p-1.5 border border-slate-400 rounded bg-white focus:outline-none focus:border-slate-900" placeholder="Type new ${category} requirement..." />
      <div class="flex items-center justify-end gap-1.5">
        <button class="btn-confirm-add px-2.5 py-1 rounded bg-slate-900 text-white font-semibold text-[11px] hover:bg-slate-800">Add</button>
        <button class="btn-cancel-add px-2 py-1 rounded text-slate-500 hover:text-slate-800 font-medium text-[11px]">Cancel</button>
      </div>
    `;

    container.prepend(addRow);
    const input = addRow.querySelector(".input-new-req");
    input.focus();

    const commitAdd = () => {
      const val = input.value.trim();
      if (val) {
        state.currentJob.requirements = state.currentJob.requirements || {};
        state.currentJob.requirements[category] = state.currentJob.requirements[category] || [];
        state.currentJob.requirements[category].push(val);
        renderRequirementsColumns();
        if ($("#raw-job-json-textarea")) {
          $("#raw-job-json-textarea").value = JSON.stringify(state.currentJob, null, 2);
        }
      } else {
        addRow.remove();
      }
    };

    addRow.querySelector(".btn-confirm-add").addEventListener("click", commitAdd);
    addRow.querySelector(".btn-cancel-add").addEventListener("click", () => addRow.remove());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitAdd();
      } else if (e.key === "Escape") {
        addRow.remove();
      }
    });
  }

  // -------------------------------------------------------------
  // Stage 3: Compatibility & Evidence Matrix
  // -------------------------------------------------------------
  async function triggerAnalysis() {
    if (!state.currentJobPath) {
      alert("Please ensure the job is saved to data/jobs/ first.");
      return;
    }

    $("#stage-job-analysis")?.classList.remove("hidden");
    $("#stage-job-analysis")?.scrollIntoView({ behavior: "smooth", block: "start" });
    updateStepIndicators(3);

    try {
      const res = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobPath: state.currentJobPath,
          analysisOnly: true,
        }),
      });

      const runState = await res.json();
      state.currentRun = runState;
      if (runState.artifacts?.analysis) {
        renderAnalysisMatrix(runState.artifacts.analysis);
      }
    } catch (err) {
      console.error("Analysis execution error:", err);
    }
  }

  function renderAnalysisMatrix(analysis) {
    state.currentAnalysis = analysis;
    const scores = analysis.scores || { coreRequirements: 0, preferred: 0, engineeringCompetencies: 0 };

    const core = scores.coreRequirements ?? 0;
    const pref = scores.preferred ?? 0;
    const comp = scores.engineeringCompetencies ?? 0;
    const overall = Math.round((core * 0.5) + (pref * 0.3) + (comp * 0.2));

    if ($("#score-overall")) $("#score-overall").textContent = `${overall}%`;
    if ($("#bar-score-overall")) $("#bar-score-overall").style.width = `${overall}%`;

    if ($("#score-core")) $("#score-core").textContent = `${core}%`;
    if ($("#bar-score-core")) $("#bar-score-core").style.width = `${core}%`;

    if ($("#score-preferred")) $("#score-preferred").textContent = `${pref}%`;
    if ($("#bar-score-preferred")) $("#bar-score-preferred").style.width = `${pref}%`;

    if ($("#score-competencies")) $("#score-competencies").textContent = `${comp}%`;
    if ($("#bar-score-competencies")) $("#bar-score-competencies").style.width = `${comp}%`;

    // Counts
    const strong = analysis.matches?.strong || [];
    const related = analysis.matches?.related || [];
    const missing = analysis.matches?.missing || [];
    const totalCount = strong.length + related.length + missing.length;

    if ($("#count-match-all")) $("#count-match-all").textContent = totalCount;
    if ($("#count-match-strong")) $("#count-match-strong").textContent = strong.length;
    if ($("#count-match-related")) $("#count-match-related").textContent = related.length;
    if ($("#count-match-missing")) $("#count-match-missing").textContent = missing.length;

    // Guidance
    const emphasisTerms = (analysis.tailoring?.recommendedEmphasis || [])
      .map((item) => typeof item === "string" ? item : item.term || "")
      .filter(Boolean);
    if ($("#analysis-recommended-emphasis")) {
      $("#analysis-recommended-emphasis").textContent = emphasisTerms.length > 0
        ? emphasisTerms.join(", ")
        : "No evidence-backed requirements were identified for emphasis.";
    }
    if ($("#count-match-emphasis")) $("#count-match-emphasis").textContent = emphasisTerms.length;
    $("#btn-view-emphasis")?.classList.toggle("hidden", emphasisTerms.length === 0);

    const prohibitedTerms = (analysis.tailoring?.doNotAdd || [])
      .map((item) => typeof item === "string" ? item : item.term || "")
      .filter(Boolean);
    if ($("#analysis-guardrails")) {
      $("#analysis-guardrails").textContent = prohibitedTerms.length > 0
        ? `Prohibited non-evidenced claims: ${prohibitedTerms.join(", ")}`
        : "No unsupported requirements were identified by the analysis.";
    }

    renderFilteredEvidenceItems();

    if (window.lucide) lucide.createIcons();
  }

  function renderFilteredEvidenceItems() {
    const analysis = state.currentAnalysis;
    if (!analysis) return;

    const strong = (analysis.matches?.strong || []).map((i) => ({ ...i, statusType: "strong" }));
    const related = (analysis.matches?.related || []).map((i) => ({ ...i, statusType: "related" }));
    const missing = (analysis.matches?.missing || []).map((i) => ({ ...i, statusType: "missing" }));

    let itemsToRender;
    if (state.activeEvidenceFilter === "strong") {
      itemsToRender = strong;
    } else if (state.activeEvidenceFilter === "related") {
      itemsToRender = related;
    } else if (state.activeEvidenceFilter === "emphasis") {
      const recommendedTerms = new Set(
        (analysis.tailoring?.recommendedEmphasis || [])
          .map((item) => typeof item === "string" ? item : item.term)
          .filter(Boolean),
      );
      itemsToRender = [...strong, ...related].filter((item) => recommendedTerms.has(item.term));
    } else if (state.activeEvidenceFilter === "missing") {
      itemsToRender = missing;
    } else {
      itemsToRender = [...strong, ...related, ...missing];
    }

    const container = $("#analysis-items-container");
    if (!container) return;
    container.innerHTML = "";

    if (!itemsToRender.length) {
      container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-lg border border-slate-200">No requirements matching this filter category.</div>`;
      return;
    }

    for (const item of itemsToRender) {
      const isStrong = item.statusType === "strong";
      const isRelated = item.statusType === "related";
      const badgeClass = isStrong
        ? "bg-emerald-100 text-emerald-800 border-emerald-200"
        : isRelated
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : "bg-slate-100 text-slate-700 border-slate-200";

      const badgeLabel = isStrong ? "Exact Match" : isRelated ? "Equivalent" : "Gap / Missing";
      const requirement = item.term || item.requirement || item.text || item.skill || "Requirement";
      const evidence = formatAnalysisEvidence(item.evidence);

      const el = document.createElement("div");
      el.className = "p-3 rounded-lg border border-slate-200 bg-white text-xs space-y-1.5 shadow-2xs hover:border-slate-300 transition-colors";
      el.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <span class="font-bold text-slate-900 text-[13px] leading-snug">${escapeHtml(requirement)}</span>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border shrink-0 ${badgeClass}">${badgeLabel}</span>
        </div>
        <p class="text-slate-700 bg-slate-50 p-2.5 rounded border border-slate-100 font-mono text-[11px] leading-relaxed whitespace-pre-line">Evidence: ${escapeHtml(evidence)}</p>
        ${item.notes ? `<p class="text-slate-500 text-[11px] italic leading-normal">${escapeHtml(item.notes)}</p>` : ""}
      `;
      container.appendChild(el);
    }
  }

  function formatAnalysisEvidence(evidence) {
    if (!Array.isArray(evidence) || evidence.length === 0) {
      return "No grounded evidence found in the master resume or evidence catalog.";
    }

    return evidence.map((entry) => {
      const source = [entry.company, entry.position].filter(Boolean).join(" — ");
      const detail = entry.text
        || entry.facts?.[0]
        || entry.matchedAs
        || entry.skill
        || entry.name
        || "Grounded evidence";
      const type = entry.type ? `[${entry.type}] ` : "";
      return `${type}${source ? `${source}: ` : ""}${detail}`;
    }).join("\n");
  }

  function setupAnalysisEvents() {
    // Filter chip buttons
    $$("#analysis-filter-chips .filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const filter = chip.getAttribute("data-filter");
        state.activeEvidenceFilter = filter;

        $$("#analysis-filter-chips .filter-chip").forEach((c) => {
          c.classList.remove("active");
          c.className = "filter-chip px-2.5 py-1 rounded-full text-xs font-medium border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1";
        });

        chip.classList.add("active");
        chip.className = "filter-chip active px-2.5 py-1 rounded-full text-xs font-semibold border border-slate-300 bg-slate-900 text-white flex items-center gap-1";

        renderFilteredEvidenceItems();
      });
    });

    $("#btn-run-full-pipeline")?.addEventListener("click", () => triggerFullPipeline());
    $("#btn-trigger-pipeline-run")?.addEventListener("click", () => triggerFullPipeline());
    $("#btn-view-emphasis")?.addEventListener("click", () => {
      $("#analysis-filter-chips [data-filter=\"emphasis\"]")?.click();
      $("#analysis-items-container")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // -------------------------------------------------------------
  // Stage 4 & 5: CI/CD Pipeline Visualizer
  // -------------------------------------------------------------
  async function triggerFullPipeline() {
    if (!state.currentJobPath) {
      alert("No job path selected.");
      return;
    }

    $("#stage-pipeline-exec")?.classList.remove("hidden");
    $("#stage-pipeline-exec")?.scrollIntoView({ behavior: "smooth", block: "start" });
    updateStepIndicators(4);

    const theme = $("#override-theme")?.value || "jsonresume-theme-stackoverflow";
    const skipRewrite = !$("#toggle-skip-rewrite")?.checked;

    resetPipelineNodes(skipRewrite);
    appendTerminalLog(`[init] Starting pipeline execution for job: ${state.currentJobPath}`);
    appendTerminalLog(`[config] Theme: ${theme} | Rewrite: ${skipRewrite ? "Disabled" : "Enabled"}`);

    // Call pipeline with Server-Sent Events (SSE)
    const pipelineController = new AbortController();
    try {
      pipelineAbortController = pipelineController;
      const response = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          jobPath: state.currentJobPath,
          theme,
          skipRewrite,
        }),
        signal: pipelineController.signal,
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          if (!block.trim()) continue;
          parseSseEvent(block);
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") appendTerminalLog(`[pipeline_error] Pipeline execution error: ${err.message}`);
    } finally {
      if (pipelineAbortController === pipelineController) pipelineAbortController = null;
    }
  }

  function parseSseEvent(block) {
    let eventType = "message";
    let eventData = "";

    const lines = block.split("\n");
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.replace("event:", "").trim();
      } else if (line.startsWith("data:")) {
        eventData = line.replace("data:", "").trim();
      }
    }

    if (!eventData) return;

    try {
      const payload = JSON.parse(eventData);
      if (eventType === "progress") {
        handlePipelineProgress(payload);
      } else if (eventType === "done") {
        handlePipelineDone();
      } else if (eventType === "pipeline_error") {
        appendTerminalLog(`[error] ${payload.error}`);
        const badge = $("#pipeline-status-badge");
        if (badge) {
          badge.textContent = "Failed";
          badge.className = "text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200";
        }
      }
    } catch (e) {
      console.error("SSE parse error:", e);
    }
  }

  function handlePipelineProgress(payload) {
    if (payload.type === "log") {
      appendTerminalLog(payload.message);
    } else if (payload.type === "stage_update") {
      const { stage, data } = payload;
      updateNodeUI(stage, data);
    } else if (payload.type === "complete") {
      state.currentRun = payload.runState;
      handlePipelineDone();
    }
  }

  function updateNodeUI(stageKey, data) {
    const node = $(`#node-${stageKey}`);
    const duration = $(`#duration-${stageKey}`);
    const icon = $(`#icon-${stageKey}`);
    if (!node) return;

    node.className = `stage-node p-3 rounded-lg border space-y-2 flex flex-col justify-between ${data.status}`;
    if (data.duration && duration) {
      duration.textContent = `${data.duration}s`;
    } else if (data.status === "running" && duration) {
      duration.textContent = "Running...";
    } else if (data.status === "skipped" && duration) {
      duration.textContent = "Skipped";
    }

    if (icon) {
      if (data.status === "running") {
        icon.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 text-blue-600 animate-spin"></i>`;
      } else if (data.status === "success") {
        icon.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-600"></i>`;
      } else if (data.status === "warning") {
        icon.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-amber-600"></i>`;
      } else if (data.status === "failed") {
        icon.innerHTML = `<i data-lucide="x-circle" class="w-3.5 h-3.5 text-rose-600"></i>`;
      } else if (data.status === "skipped") {
        icon.innerHTML = `<i data-lucide="skip-forward" class="w-3.5 h-3.5 text-slate-400"></i>`;
      }
    }

    if (window.lucide) lucide.createIcons();
  }

  function resetPipelineNodes(skipRewrite) {
    const stages = ["analyse", "tailor", "rewrite", "summary", "finalCheck", "render"];
    for (const st of stages) {
      const isSkip = (st === "rewrite" || st === "summary") && skipRewrite;
      updateNodeUI(st, {
        status: isSkip ? "skipped" : "pending",
        duration: null,
      });
    }
    const badge = $("#pipeline-status-badge");
    if (badge) {
      badge.textContent = "Running";
      badge.className = "text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200";
    }
    $("#btn-jump-preview")?.classList.add("hidden");
  }

  function appendTerminalLog(text) {
    const terminal = $("#pipeline-log-terminal");
    if (!terminal) return;
    const div = document.createElement("div");

    if (text.includes("[error]") || text.includes("Error")) {
      div.className = "text-rose-400 font-mono";
    } else if (text.includes("[stage:") || text.includes("Stage")) {
      div.className = "text-blue-300 font-mono font-semibold";
    } else if (text.includes("[done]") || text.includes("Completed")) {
      div.className = "text-emerald-400 font-mono font-semibold";
    } else {
      div.className = "text-slate-300 font-mono";
    }

    div.textContent = text;
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
  }

  function handlePipelineDone() {
    const badge = $("#pipeline-status-badge");
    if (badge) {
      badge.textContent = "Completed";
      badge.className = "text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200";
    }
    $("#btn-jump-preview")?.classList.remove("hidden");

    // Populate Final Check Audit Card
    if (state.currentRun?.artifacts?.finalCheck) {
      renderFinalCheckCard(state.currentRun.artifacts.finalCheck);
    }

    // Auto-advance to preview
    loadArtifactsPreview();
  }

  function renderFinalCheckCard(finalCheck) {
    const card = $("#final-check-audit-card");
    if (!card) return;
    card.classList.remove("hidden");

    const badge = $("#final-check-status-badge");
    const status = finalCheck.status || "pass";
    if (badge) {
      badge.textContent = status.toUpperCase();
      if (status === "pass") {
        badge.className = "text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800";
      } else if (status === "warning") {
        badge.className = "text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800";
      } else {
        badge.className = "text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800";
      }
    }

    const counts = finalCheck.counts || {};
    if ($("#final-check-summary-text")) {
      $("#final-check-summary-text").textContent = `Audit completed: ${counts.errors || 0} factual errors, ${counts.warnings || 0} warnings, and ${counts.info || 0} notes. Factual integrity is strictly verified against candidate evidence.`;
    }

    const issuesList = $("#final-check-issues-list");
    if (issuesList) {
      issuesList.innerHTML = "";
      const errors = finalCheck.errors || [];
      const warnings = finalCheck.warnings || [];

      for (const err of errors) {
        const el = document.createElement("div");
        el.className = "text-rose-700 font-medium flex items-center gap-1.5";
        el.innerHTML = `<i data-lucide="x" class="w-3.5 h-3.5 shrink-0"></i> <span>Error: ${escapeHtml(err.message || err)}</span>`;
        issuesList.appendChild(el);
      }

      for (const warn of warnings) {
        const el = document.createElement("div");
        el.className = "text-amber-800 font-medium flex items-center gap-1.5";
        el.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5 shrink-0"></i> <span>Warning: ${escapeHtml(warn.message || warn)}</span>`;
        issuesList.appendChild(el);
      }
    }

    if (window.lucide) lucide.createIcons();
  }

  // -------------------------------------------------------------
  // Stage 6: Artifacts, Preview & Dynamic Theme Switcher
  // -------------------------------------------------------------
  function loadArtifactsPreview() {
    $("#stage-preview-artifacts")?.classList.remove("hidden");
    $("#stage-preview-artifacts")?.scrollIntoView({ behavior: "smooth", block: "start" });
    updateStepIndicators(5);

    const companySlug = state.currentRun?.companySlug || (state.currentJob?.company ? slugify(state.currentJob.company) : "flash");

    // Set preview URL
    const previewUrl = `/api/artifacts/${companySlug}/preview`;
    if ($("#resume-preview-frame")) $("#resume-preview-frame").src = previewUrl;
    if ($("#preview-url-label")) $("#preview-url-label").textContent = `output/${companySlug}/resume.html`;
    if ($("#btn-open-preview-tab")) $("#btn-open-preview-tab").href = previewUrl;

    // Set download buttons
    if ($("#btn-download-pdf")) $("#btn-download-pdf").href = `/api/artifacts/${companySlug}/resume.pdf?download=1`;
    if ($("#btn-download-html")) $("#btn-download-html").href = `/api/artifacts/${companySlug}/resume.html?download=1`;
    if ($("#btn-download-txt")) $("#btn-download-txt").href = `/api/artifacts/${companySlug}/resume.txt?download=1`;
    if ($("#btn-download-json")) $("#btn-download-json").href = `/api/artifacts/${companySlug}/resume-final.json?download=1`;

    // Load Side-by-Side Diff Content
    loadSideBySideDiff(companySlug);
  }

  async function loadSideBySideDiff(companySlug) {
    try {
      const [baseRes, tailoredRes] = await Promise.all([
        fetch("/data/resumes/base.json").catch(() => null),
        fetch(`/api/artifacts/${companySlug}/resume-final.json`).catch(() => null),
      ]);

      const baseJson = baseRes?.ok ? await baseRes.json() : null;
      const tailoredJson = tailoredRes?.ok ? await tailoredRes.json() : null;

      renderDiffPanels(baseJson, tailoredJson);
    } catch (e) {
      console.warn("Could not load diff:", e);
    }
  }

  function renderDiffPanels(base, tailored) {
    const baseContainer = $("#diff-base-content");
    const tailoredContainer = $("#diff-tailored-content");
    if (!baseContainer || !tailoredContainer) return;

    if (!base || !tailored) {
      baseContainer.innerHTML = `<div class="text-slate-400 p-4">Base resume data pending.</div>`;
      tailoredContainer.innerHTML = `<div class="text-slate-400 p-4">Tailored resume output pending.</div>`;
      return;
    }

    // Render Work Experiences comparison
    baseContainer.innerHTML = (base.work || []).map((w) => `
      <div class="p-3 bg-white rounded-lg border border-slate-200 space-y-1.5 shadow-2xs">
        <div class="font-bold text-slate-900 text-xs">${escapeHtml(w.name || w.company)} — ${escapeHtml(w.position)}</div>
        <div class="text-[10px] text-slate-500 font-mono">${escapeHtml(w.startDate || "")} - ${escapeHtml(w.endDate || "Present")}</div>
        <ul class="list-disc list-inside space-y-1 text-slate-600 text-[11px] leading-relaxed">
          ${(w.highlights || []).map((h) => `<li>${escapeHtml(h)}</li>`).join("")}
        </ul>
      </div>
    `).join("");

    tailoredContainer.innerHTML = (tailored.work || []).map((w) => `
      <div class="p-3 bg-white rounded-lg border border-emerald-300 space-y-1.5 shadow-2xs">
        <div class="font-bold text-emerald-950 text-xs">${escapeHtml(w.name || w.company)} — ${escapeHtml(w.position)}</div>
        <div class="text-[10px] text-emerald-700 font-semibold font-mono">${escapeHtml(w.startDate || "")} - ${escapeHtml(w.endDate || "Present")}</div>
        <ul class="list-disc list-inside space-y-1 text-emerald-950 text-[11px] leading-relaxed">
          ${(w.highlights || []).map((h) => `<li class="bg-emerald-100/60 p-1 rounded font-medium">${escapeHtml(h)}</li>`).join("")}
        </ul>
      </div>
    `).join("");
  }

  function setupPreviewEvents() {
    $("#btn-jump-preview")?.addEventListener("click", () => {
      loadArtifactsPreview();
    });

    // Console Logs Drawer Toggle Button
    $("#btn-toggle-tech-logs")?.addEventListener("click", () => {
      const drawer = $("#terminal-drawer");
      const textSpan = $("#btn-toggle-logs-text");
      if (!drawer) return;

      const isHidden = drawer.classList.contains("hidden");
      if (isHidden) {
        drawer.classList.remove("hidden");
        if (textSpan) textSpan.textContent = "Hide Console Logs";
      } else {
        drawer.classList.add("hidden");
        if (textSpan) textSpan.textContent = "Show Console Logs";
      }
    });

    // Clear logs button
    $("#btn-clear-logs")?.addEventListener("click", () => {
      const terminal = $("#pipeline-log-terminal");
      if (terminal) terminal.innerHTML = '<div class="text-slate-500">[log cleared]</div>';
    });

    // Theme Switchers
    $("#theme-btn-stackoverflow")?.addEventListener("click", () => switchTheme("jsonresume-theme-stackoverflow"));
    $("#theme-btn-modern-plain")?.addEventListener("click", () => switchTheme("jsonresume-theme-modern-plain"));

    // Preview Sub-Tabs (Rendered Preview vs Side-by-Side Diff)
    const tabLive = $("#tab-live-preview");
    const tabDiff = $("#tab-diff-view");
    const containerLive = $("#container-live-preview");
    const containerDiff = $("#container-diff-view");

    tabLive?.addEventListener("click", () => {
      tabLive.className = "px-4 py-2 border-b-2 border-slate-900 text-xs font-bold text-slate-900 flex items-center gap-1.5";
      tabDiff.className = "px-4 py-2 border-b-2 border-transparent text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1.5";
      containerLive?.classList.remove("hidden");
      containerDiff?.classList.add("hidden");
    });

    tabDiff?.addEventListener("click", () => {
      tabDiff.className = "px-4 py-2 border-b-2 border-slate-900 text-xs font-bold text-slate-900 flex items-center gap-1.5";
      tabLive.className = "px-4 py-2 border-b-2 border-transparent text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1.5";
      containerDiff?.classList.remove("hidden");
      containerLive?.classList.add("hidden");
    });
  }

  async function switchTheme(themeId) {
    state.currentTheme = themeId;
    const companySlug = state.currentRun?.companySlug || (state.currentJob?.company ? slugify(state.currentJob.company) : "flash");
    const resumePath = `output/${companySlug}/resume-final.json`;

    const btnStackOverflow = $("#theme-btn-stackoverflow");
    const btnModernPlain = $("#theme-btn-modern-plain");
    const spinner = $("#rerender-spinner");

    if (themeId === "jsonresume-theme-stackoverflow") {
      if (btnStackOverflow) btnStackOverflow.className = "theme-switch-btn active px-2.5 py-1 text-xs font-semibold rounded-l-md bg-slate-900 text-white";
      if (btnModernPlain) btnModernPlain.className = "theme-switch-btn px-2.5 py-1 text-xs font-semibold rounded-r-md bg-slate-100 text-slate-700 hover:bg-slate-200";
    } else {
      if (btnModernPlain) btnModernPlain.className = "theme-switch-btn active px-2.5 py-1 text-xs font-semibold rounded-r-md bg-slate-900 text-white";
      if (btnStackOverflow) btnStackOverflow.className = "theme-switch-btn px-2.5 py-1 text-xs font-semibold rounded-l-md bg-slate-100 text-slate-700 hover:bg-slate-200";
    }

    spinner?.classList.remove("hidden");

    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumePath,
          theme: themeId,
          outputDir: `output/${companySlug}`,
        }),
      });

      if (!res.ok) throw new Error("Render request failed");

      // Reload preview iframe
      const iframe = $("#resume-preview-frame");
      if (iframe) iframe.src = `/api/artifacts/${companySlug}/preview?t=${Date.now()}`;
    } catch (err) {
      alert(`Could not rerender theme: ${err.message}`);
    } finally {
      spinner?.classList.add("hidden");
    }
  }

  // -------------------------------------------------------------
  // Evidence Base Management & Guided Career Interview
  // -------------------------------------------------------------
  async function fetchEvidenceSummary() {
    try {
      const res = await fetch("/api/evidence/summary");
      const summary = await res.json();
      state.evidenceSummary = summary;

      if ($("#metric-experiences-count")) $("#metric-experiences-count").textContent = summary.careerRolesCount ?? summary.experiencesCount ?? 0;
      if ($("#metric-facts-count")) $("#metric-facts-count").textContent = summary.factsCount || 0;
      if ($("#metric-skills-count")) $("#metric-skills-count").textContent = summary.skillsCount || 0;
      if ($("#metric-queue-count")) $("#metric-queue-count").textContent = summary.pendingReviewCount || 0;
      if ($("#badge-queue-pending")) $("#badge-queue-pending").textContent = summary.pendingReviewCount || 0;
      renderHome();
    } catch (err) {
      console.error("Evidence summary error:", err);
    }
  }

  const linkedInSectionLabels = { basics: "Profile", about: "About", skills: "Skills", work: "Experience", education: "Education", certificates: "Certifications", publications: "Publications", projects: "Projects", languages: "Languages", volunteer: "Volunteer", awards: "Awards", recommendations: "Recommendations" };
  function linkedInCardTitle(item) {
    const candidate = item.candidate || {};
    if (item.section === "basics") return ({ name: "Name", label: "Professional title", email: "Email", phone: "Phone", location: "Location", profiles: "LinkedIn profile" })[item.field] || "Profile information";
    if (item.section === "about") return "Professional summary";
    return candidate.position || candidate.institution || candidate.name || candidate.title || candidate.organization || candidate.language || "Imported information";
  }
  function linkedInCardMeta(item) {
    const candidate = item.candidate || {};
    if (item.section === "work") return [candidate.name, [candidate.startDate, candidate.endDate || "Current"].filter(Boolean).join(" — ")].filter(Boolean).join(" · ");
    if (item.section === "education") return [candidate.studyType, candidate.area, [candidate.startDate, candidate.endDate].filter(Boolean).join(" — ")].filter(Boolean).join(" · ");
    if (item.section === "certificates") return [candidate.issuer, candidate.date].filter(Boolean).join(" · ");
    if (item.section === "languages") return candidate.fluency || "Level not provided";
    return candidate.summary || candidate.description || candidate.publisher || candidate.awarder || "";
  }
  function linkedInValue(value) {
    if (value && typeof value === "object") return Object.values(value).filter(Boolean).join(" · ");
    return String(value ?? "Not provided");
  }
  async function loadLinkedInImportHistory() {
    const container = $("#linkedin-import-history");
    if (!container) return;
    try {
      const response = await fetch("/api/linkedin-import/history");
      if (!response.ok) throw new Error("Could not load import history.");
      const history = await response.json();
      if (!history.length) { container.textContent = ""; return; }
      const latest = history[0];
      container.innerHTML = `<div class="border-t border-slate-200 pt-3">Last import: ${escapeHtml(new Date(latest.appliedAt).toLocaleString())} · ${latest.applied} applied · ${latest.skipped} skipped. <button type="button" data-linkedin-history-toggle class="underline font-semibold">View import history</button><div data-linkedin-history-list class="hidden mt-2 space-y-1">${history.map((entry) => `<p>${escapeHtml(new Date(entry.appliedAt).toLocaleString())} — ${entry.applied} applied, ${entry.skipped} skipped (${entry.itemsFound} reviewed)</p>`).join("")}</div></div>`;
      container.querySelector("[data-linkedin-history-toggle]")?.addEventListener("click", (event) => { const list = container.querySelector("[data-linkedin-history-list]"); const hidden = list?.classList.toggle("hidden"); event.currentTarget.textContent = hidden ? "View import history" : "Hide import history"; });
    } catch (error) { console.error("LinkedIn import history error:", error); }
  }
  function renderLinkedInReview(report, container) {
    const mapped = report.records.filter((item) => item.mappingStatus === "mapped");
    const groups = Object.groupBy(mapped, (item) => item.section);
    const tabs = Object.keys(groups);
    const cards = (section) => (groups[section] || []).map((item) => {
      const needsReview = item.reviewStatus === "conflict" || item.reviewStatus === "duplicate";
      const candidateEntries = item.candidate && typeof item.candidate === "object" && !Array.isArray(item.candidate) ? Object.entries(item.candidate) : [[item.field || "valor", item.candidate]];
      const details = candidateEntries.filter(([key]) => !["highlights", "profiles"].includes(key) && !(item.section === "publications" && key === "name")).map(([key, value]) => {
        const content = typeof value === "object" ? JSON.stringify(value) : String(value);
        const prose = ["summary", "description", "text"].includes(key);
        return `<div class="${prose ? "sm:col-span-2" : ""}"><dt class="text-slate-400 capitalize">${escapeHtml(key.replace(/([A-Z])/g, " $1"))}</dt><dd class="text-slate-700 break-words ${prose ? "whitespace-pre-wrap leading-relaxed max-w-4xl" : ""}">${escapeHtml(content)}</dd></div>`;
      }).join("");
      const wideCard = ["about", "basics"].includes(section);
      const conflict = item.existing ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs border border-amber-200 bg-amber-50 rounded-lg p-3"><div><p class="font-semibold text-amber-900">Current resume</p><p class="text-amber-800 break-words">${escapeHtml(linkedInValue(item.existing))}</p></div><div><p class="font-semibold text-amber-900">Imported value</p><p class="text-amber-800 break-words">${escapeHtml(linkedInValue(item.candidate))}</p></div></div>` : "";
      return `<article class="border border-slate-200 rounded-xl p-4 bg-white space-y-3 ${wideCard ? "lg:col-span-2" : ""}" data-linkedin-card="${escapeHtml(item.id)}"><div class="flex gap-3 justify-between"><div class="min-w-0 flex-1"><h5 class="font-bold text-slate-900 text-sm leading-snug break-words">${escapeHtml(linkedInCardTitle(item))}</h5><p class="text-xs text-slate-500 mt-0.5 leading-relaxed break-words">${escapeHtml(linkedInCardMeta(item))}</p></div><span class="shrink-0 h-fit px-2 py-0.5 rounded-full text-[10px] font-bold ${needsReview ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}">${needsReview ? "Review" : "Ready"}</span></div>${conflict}${details ? `<dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">${details}</dl>` : ""}<div class="flex items-center justify-between gap-3 pt-1"><label class="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked data-linkedin-include="${escapeHtml(item.id)}" class="accent-emerald-700"> Include in resume</label>${item.existing ? `<select class="border border-slate-300 rounded p-1.5 text-xs" data-linkedin-resolution="${escapeHtml(item.id)}"><option value="approved">Use imported value</option><option value="keep_existing">Keep existing value</option></select>` : ""}</div></article>`;
    }).join("");
    const emptySections = report.diagnostics?.emptyDetectedSections || [];
    container.innerHTML = `<section class="mt-5 border-t border-slate-200 pt-5 space-y-4"><div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3"><div><p class="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Import ready for review</p><h4 class="text-base font-bold text-slate-900">Found ${report.summary.itemsFound} items across ${report.summary.sectionsFound} sections</h4><p class="text-xs text-slate-500 mt-1">Review only what you want to include. Flagged items need attention before updating your resume.</p></div><div class="flex gap-2 text-xs"><span class="px-2 py-1 rounded bg-emerald-50 text-emerald-800">${report.summary.ready} ready</span>${report.summary.conflicts ? `<span class="px-2 py-1 rounded bg-amber-50 text-amber-800">${report.summary.conflicts} to review</span>` : ""}</div></div>${emptySections.length ? `<div class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"><strong>Incomplete extraction:</strong> ${escapeHtml(emptySections.map((section) => linkedInSectionLabels[section] || section).join(", "))} was detected, but no records could be confirmed. Review the PDF before updating your resume.</div>` : ""}<nav class="flex gap-2 overflow-x-auto pb-1" aria-label="Imported sections">${tabs.map((section, index) => `<button type="button" data-linkedin-tab="${escapeHtml(section)}" class="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold ${index ? "bg-slate-100 text-slate-600" : "bg-slate-900 text-white"}">${escapeHtml(linkedInSectionLabels[section] || section)} <span class="opacity-70">${groups[section].length}</span></button>`).join("")}</nav><div>${tabs.map((section, index) => `<div data-linkedin-panel="${escapeHtml(section)}" class="grid grid-cols-1 lg:grid-cols-2 gap-3 ${index ? "hidden" : ""}">${cards(section)}</div>`).join("")}</div><div class="flex flex-col-reverse sm:flex-row justify-between gap-3 pt-2 border-t border-slate-200"><p class="text-xs text-slate-500">Recommendations and unmapped data stay outside your resume.</p><button id="btn-linkedin-apply" class="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold">Apply selected items to resume</button></div></section>`;
    container.querySelectorAll("[data-linkedin-tab]").forEach((button) => button.addEventListener("click", () => { const section = button.dataset.linkedinTab; container.querySelectorAll("[data-linkedin-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.linkedinPanel !== section)); container.querySelectorAll("[data-linkedin-tab]").forEach((tab) => { const active = tab === button; tab.className = `shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`; }); }));
  }

  function setupEvidenceEvents() {
    $("#btn-linkedin-import")?.addEventListener("click", async () => {
      const review = $("#linkedin-import-review");
      try {
        const file = $("#linkedin-import-pdf")?.files?.[0];
        let endpoint = "/api/linkedin-import";
        let payload;
        if (file) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = ""; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
          endpoint = "/api/linkedin-import/pdf"; payload = { pdfBase64: btoa(binary) };
        } else payload = { source: JSON.parse($("#linkedin-import-source").value) };
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const report = await response.json(); if (!response.ok) throw new Error(report.error);
        renderLinkedInReview(report, review);
        $("#btn-linkedin-apply")?.addEventListener("click", async () => {
          const decisions = report.records.filter((item) => item.mappingStatus === "mapped").map((item) => { const included = review.querySelector(`[data-linkedin-include="${item.id}"]`)?.checked; const selected = review.querySelector(`[data-linkedin-resolution="${item.id}"]`)?.value; return { id: item.id, status: included ? (selected || "approved") : "rejected" }; });
          const result = await fetch("/api/linkedin-import/promote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisions }) }); const applied = await result.json(); if (!result.ok) throw new Error(applied.error); $("#evidence-builder-container")?.classList.add("hidden"); await Promise.all([fetchEvidenceSummary(), loadEvidenceCatalog(), refreshEvidenceReviewAvailability(), loadLinkedInImportHistory()]); showToast("Imported data and experiences are updated."); review.innerHTML = `<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">Selected items were added to your career history. Add details to a role whenever you want to include projects, responsibilities, achievements, or technologies.</div>`; $("#evidence-catalog-container")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } catch (error) { review.textContent = error.message || "Unable to parse the LinkedIn profile."; }
    });
    const buildModal = $("#modal-build-evidence");
    const closeBuildModal = () => {
      buildModal?.classList.add("hidden");
      $("#build-evidence-error")?.classList.add("hidden");
    };
    const showBuildError = (message) => {
      const error = $("#build-evidence-error");
      if (error) { error.textContent = message; error.classList.remove("hidden"); }
    };
    const addSourceInput = () => {
      $("#evidence-source-inputs")?.insertAdjacentHTML("beforeend", `<div data-evidence-source class="grid grid-cols-[8rem_1fr_auto] gap-2"><select data-source-type class="border border-slate-300 rounded p-2 bg-white"><option value="linkedin">LinkedIn</option><option value="github">GitHub</option><option value="feedback">Feedback</option><option value="manual">Manual</option></select><input data-source-reference class="border border-slate-300 rounded p-2" placeholder="URL, document, or note reference"><button type="button" data-remove-evidence-source class="text-slate-500 hover:text-rose-600" aria-label="Remove source">×</button></div>`);
    };
    $("#btn-build-evidence")?.addEventListener("click", () => {
      buildModal?.classList.remove("hidden");
      if (window.lucide) lucide.createIcons();
    });
    $("#btn-resume-evidence-review")?.addEventListener("click", async () => {
      await loadEvidenceBuilder();
      $("#evidence-builder-container")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#btn-close-build-evidence-modal")?.addEventListener("click", closeBuildModal);
    $("#btn-cancel-build-evidence")?.addEventListener("click", closeBuildModal);
    $("#btn-add-evidence-source")?.addEventListener("click", addSourceInput);
    $("#evidence-source-inputs")?.addEventListener("click", (event) => event.target.closest("[data-remove-evidence-source]")?.closest("[data-evidence-source]")?.remove());
    $$('input[name="evidence-resume-source"]').forEach((input) => input.addEventListener("change", () => {
      $("#input-evidence-resume-file")?.classList.toggle("hidden", $("input[name=\"evidence-resume-source\"]:checked")?.value !== "file");
    }));
    $("#btn-submit-build-evidence")?.addEventListener("click", async () => {
      try {
        const supportingSources = [...$$('[data-evidence-source]')].map((row) => ({ type: row.querySelector("[data-source-type]")?.value, reference: row.querySelector("[data-source-reference]")?.value.trim() })).filter((item) => item.reference);
        const incompleteSource = [...$$('[data-evidence-source]')].some((row) => !row.querySelector("[data-source-reference]")?.value.trim());
        if (incompleteSource) throw new Error("Every supporting source needs a reference or should be removed.");
        const payload = { supportingSources };
        if ($("input[name=\"evidence-resume-source\"]:checked")?.value === "file") {
          const file = $("#input-evidence-resume-file")?.files?.[0];
          if (!file) throw new Error("Choose a structured resume JSON file.");
          try { payload.resume = JSON.parse(await file.text()); } catch { throw new Error("The selected file is not valid JSON."); }
          payload.sourceReference = file.name;
        }
        const data = await evidenceBuilderApi.build(payload);
        closeBuildModal();
        showToast("Candidate evidence created. Review claims before promotion.");
        renderEvidenceBuilder(data);
        await refreshEvidenceReviewAvailability();
      } catch (err) { showBuildError(err.message); }
    });
    // Search filter
    $("#input-evidence-search")?.addEventListener("input", (e) => {
      loadEvidenceCatalog(e.target.value);
    });

    $("#select-evidence-type")?.addEventListener("change", (e) => {
      state.activeEvidenceType = e.target.value;
      loadEvidenceCatalog($("#input-evidence-search")?.value || "");
    });

    // Clear skill filter
    $("#btn-clear-skill-filter")?.addEventListener("click", () => {
      state.activeEvidenceSkill = "";
      loadEvidenceCatalog($("#input-evidence-search")?.value || "");
    });

    // Sub-Tabs
    $("#tab-evidence-catalog")?.addEventListener("click", () => {
      $("#tab-evidence-catalog").className = "px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white";
      $("#tab-evidence-queue").className = "px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center gap-1.5";
      $("#evidence-catalog-container")?.classList.remove("hidden");
      $("#evidence-queue-container")?.classList.add("hidden");
      loadEvidenceCatalog($("#input-evidence-search")?.value || "");
    });

    $("#tab-evidence-queue")?.addEventListener("click", () => {
      $("#tab-evidence-queue").className = "px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white flex items-center gap-1.5";
      $("#tab-evidence-catalog").className = "px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100";
      $("#evidence-queue-container")?.classList.remove("hidden");
      $("#evidence-catalog-container")?.classList.add("hidden");
      loadReviewQueue();
    });

    // Guided Interview Modal Triggers
    $("#btn-open-interview-modal")?.addEventListener("click", () => {
      $("#modal-interview")?.classList.remove("hidden");
    });
    $("#btn-close-interview")?.addEventListener("click", () => {
      $("#modal-interview")?.classList.add("hidden");
    });
    $("#btn-cancel-interview")?.addEventListener("click", () => {
      $("#modal-interview")?.classList.add("hidden");
    });

    // Submit Guided Interview
    $("#btn-submit-interview")?.addEventListener("click", async () => {
      const company = $("#interview-company").value.trim();
      const position = $("#interview-position").value.trim();
      const period = $("#interview-period").value.trim();
      const rawFacts = $("#interview-facts").value.trim();
      const rawSkills = $("#interview-skills").value.trim();

      if (!company || !position || !rawFacts) {
        alert("Please fill in Company, Role, and at least one factual claim.");
        return;
      }

      const facts = rawFacts.split("\n").map((f) => f.trim()).filter(Boolean);
      const skills = rawSkills.split(",").map((s) => s.trim()).filter(Boolean);

      try {
        const res = await fetch("/api/evidence/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company,
            position,
            period,
            facts,
            skills,
            source: "guided_interview",
          }),
        });

        if (!res.ok) throw new Error("Could not submit interview facts.");
        showToast("Your career details were saved and are ready for profile review.");

        $("#modal-interview")?.classList.add("hidden");
        // Clear inputs
        $("#interview-company").value = "";
        $("#interview-position").value = "";
        $("#interview-period").value = "";
        $("#interview-facts").value = "";
        $("#interview-skills").value = "";

        await fetchEvidenceSummary();
      } catch (err) {
        alert(`Submission error: ${err.message}`);
      }
    });

    // Direct Experience Modal (Senior Design Improvement replacing browser prompts)
    $("#btn-add-experience-modal")?.addEventListener("click", () => {
      $("#modal-add-experience")?.classList.remove("hidden");
    });
    $("#btn-close-add-exp")?.addEventListener("click", () => {
      $("#modal-add-experience")?.classList.add("hidden");
    });
    $("#btn-cancel-add-exp")?.addEventListener("click", () => {
      $("#modal-add-experience")?.classList.add("hidden");
    });

    $("#btn-save-direct-exp")?.addEventListener("click", async () => {
      const company = $("#direct-exp-company")?.value.trim();
      const position = $("#direct-exp-position")?.value.trim();
      const period = $("#direct-exp-period")?.value.trim() || "Present";
      const type = $("#direct-exp-type")?.value || "professional";
      const rawSkills = $("#direct-exp-skills")?.value.trim() || "";
      const rawFacts = $("#direct-exp-facts")?.value.trim() || "";

      if (!company || !position) {
        alert("Please provide both Company and Role/Position.");
        return;
      }

      const skills = rawSkills.split(",").map((s) => s.trim()).filter(Boolean);
      const facts = rawFacts.split("\n").map((f) => f.trim()).filter(Boolean);

      try {
        const res = await fetch("/api/evidence/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company,
            position,
            period,
            type,
            skills,
            facts,
            source: "manual",
          }),
        });

        if (!res.ok) throw new Error("Failed to add experience.");

        $("#modal-add-experience")?.classList.add("hidden");
        $("#modal-build-evidence")?.classList.add("hidden");
        $("#direct-exp-company").value = "";
        $("#direct-exp-position").value = "";
        $("#direct-exp-period").value = "";
        $("#direct-exp-skills").value = "";
        if ($("#direct-exp-facts")) $("#direct-exp-facts").value = "";

        showToast("Your role was added and is ready for profile review.");
        await fetchEvidenceSummary();
        loadEvidenceCatalog($("#input-evidence-search")?.value || "");
      } catch (err) {
        alert(err.message);
      }
    });

  }

  function renderEvidenceSkills() {
    const cloudEl = $("#evidence-skills-cloud");
    const countBadge = $("#evidence-skills-count-badge");
    const filterBar = $("#active-skill-filter-bar");
    const filterName = $("#active-skill-filter-name");

    const skillsDict = state.catalogSkills || {};
    const skillKeys = Object.keys(skillsDict);
    const frequencies = state.catalogSkillFrequencies || {};

    if (countBadge) {
      countBadge.textContent = `${skillKeys.length} cataloged`;
    }

    if (filterBar && filterName) {
      if (state.activeEvidenceSkill) {
        filterBar.classList.remove("hidden");
        filterName.textContent = state.activeEvidenceSkill;
      } else {
        filterBar.classList.add("hidden");
        filterName.textContent = "";
      }
    }

    if (!cloudEl) return;

    // Categorized groups from base resume skills
    const baseSkills = state.catalogBaseSkills || [];
    const renderedSkillSet = new Set();

    let html = "";

    if (baseSkills.length > 0) {
      html += `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">`;
      for (const cat of baseSkills) {
        const catKeywords = cat.keywords || [];
        if (!catKeywords.length) continue;

        html += `
          <div class="p-3 bg-slate-50/80 rounded-lg border border-slate-200/80 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-slate-700"></span>
                <span>${escapeHtml(cat.name)}</span>
              </span>
              <span class="text-[10px] font-semibold text-slate-500 font-mono">${catKeywords.length} skills</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${catKeywords
                .map((kw) => {
                  renderedSkillSet.add(kw.toLowerCase());
                  const freq = frequencies[kw] || 0;
                  const isSelected =
                    state.activeEvidenceSkill &&
                    state.activeEvidenceSkill.toLowerCase() === kw.toLowerCase();

                  return `
                  <button type="button" data-skill="${escapeHtml(kw)}" class="btn-evidence-skill inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md transition-all shadow-2xs ${
                    isSelected
                      ? "bg-slate-900 text-white ring-2 ring-slate-900 ring-offset-1"
                      : "bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 hover:border-slate-400"
                  }">
                    <span>${escapeHtml(kw)}</span>
                    ${
                      freq > 0
                        ? `<span class="text-[10px] font-bold px-1.5 py-0.2 rounded ${
                            isSelected
                              ? "bg-white/25 text-white"
                              : "bg-slate-100 text-slate-700 border border-slate-200"
                          }">${freq}</span>`
                        : ""
                    }
                  </button>
                `;
                })
                .join("")}
            </div>
          </div>
        `;
      }
      html += `</div>`;
    }

    // Additional ground-truth skills from evidence.json not in base categories
    const extraSkills = skillKeys.filter((s) => !renderedSkillSet.has(s.toLowerCase()));
    if (extraSkills.length > 0) {
      html += `
        <div class="p-3 bg-slate-50/80 rounded-lg border border-slate-200/80 space-y-2 mt-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-slate-700"></span>
              <span>Additional Ground-Truth Skills</span>
            </span>
            <span class="text-[10px] font-semibold text-slate-500 font-mono">${extraSkills.length} skills</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            ${extraSkills
              .map((s) => {
                const freq = frequencies[s] || 0;
                const isSelected =
                  state.activeEvidenceSkill &&
                  state.activeEvidenceSkill.toLowerCase() === s.toLowerCase();

                return `
                <button type="button" data-skill="${escapeHtml(s)}" class="btn-evidence-skill inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md transition-all shadow-2xs ${
                  isSelected
                    ? "bg-slate-900 text-white ring-2 ring-slate-900 ring-offset-1"
                    : "bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 hover:border-slate-400"
                }">
                  <span>${escapeHtml(s)}</span>
                  ${
                    freq > 0
                      ? `<span class="text-[10px] font-bold px-1.5 py-0.2 rounded ${
                          isSelected
                            ? "bg-white/25 text-white"
                            : "bg-slate-100 text-slate-700 border border-slate-200"
                        }">${freq}</span>`
                      : ""
                  }
                </button>
              `;
              })
              .join("")}
          </div>
        </div>
      `;
    }

    cloudEl.innerHTML = html;

    // Attach click listeners to all skill chips
    cloudEl.querySelectorAll(".btn-evidence-skill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const skill = btn.getAttribute("data-skill");
        if (state.activeEvidenceSkill && state.activeEvidenceSkill.toLowerCase() === skill.toLowerCase()) {
          state.activeEvidenceSkill = "";
        } else {
          state.activeEvidenceSkill = skill;
        }
        loadEvidenceCatalog($("#input-evidence-search")?.value || "");
      });
    });
  }

  function renderEvidenceCards() {
    const container = $("#evidence-catalog-container");
    if (!container) return;

    const exps = state.catalogExperiences || [];

    if (!exps.length) {
      const activeFilterMsg = state.activeEvidenceSkill
        ? ` with skill "${escapeHtml(state.activeEvidenceSkill)}"`
        : "";
      container.innerHTML = `
        <div class="p-8 text-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200 space-y-2">
          <p>No experiences matching current criteria${activeFilterMsg}.</p>
          ${
            state.activeEvidenceSkill
              ? `<button id="btn-empty-clear-skill" class="text-xs font-semibold text-slate-900 underline hover:text-slate-700">Clear skill filter</button>`
              : ""
          }
        </div>
      `;
      container.querySelector("#btn-empty-clear-skill")?.addEventListener("click", () => {
        state.activeEvidenceSkill = "";
        loadEvidenceCatalog($("#input-evidence-search")?.value || "");
      });
      return;
    }

    container.innerHTML = exps
      .map((exp) => {
        const skills = exp.skills || [];
        const facts = exp.facts || [];

        return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-2xs p-4 sm:p-5 space-y-4 hover:border-slate-300 transition-colors" data-id="${escapeHtml(exp.id)}">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-sm font-bold text-slate-900 break-words">${escapeHtml(exp.company)}</h3>
                <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 shrink-0">${escapeHtml(exp.type || "role")}</span>
              </div>
              <p class="text-xs font-semibold text-slate-800 mt-0.5 break-words">${escapeHtml(exp.position)}</p>
              <p class="text-[11px] text-slate-500 font-mono mt-0.5">${escapeHtml(exp.period || "Present")}</p>
            </div>
            <div class="shrink-0 text-right space-y-1">
              <span class="block text-[10px] font-semibold text-slate-500">${exp.sourceKind === "resume" ? "Imported from your resume" : "Confirmed career detail"}</span>
              <button type="button" class="btn-complete-role text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 underline" data-company="${escapeHtml(exp.company)}" data-position="${escapeHtml(exp.position)}" data-period="${escapeHtml(exp.period || "")}">Add details</button>
            </div>
          </div>

          <!-- Demonstrated Skills (Emphasized) -->
          ${
            skills.length
              ? `
            <div class="pt-2.5 border-t border-slate-100 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <i data-lucide="tag" class="w-3 h-3 text-slate-500"></i>
                  <span>Demonstrated Skills & Tech Stack (${skills.length})</span>
                </span>
                <span class="text-[10px] text-slate-400">Click a badge to filter</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                ${skills
                  .map((s) => {
                    const isMatched =
                      state.activeEvidenceSkill &&
                      state.activeEvidenceSkill.toLowerCase() === s.toLowerCase();
                    return `
                    <button type="button" data-skill="${escapeHtml(s)}" class="btn-evidence-skill inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md transition-all shadow-2xs ${
                      isMatched
                        ? "bg-slate-900 text-white ring-2 ring-slate-900 ring-offset-1"
                        : "bg-slate-50 hover:bg-slate-100 text-slate-800 border border-slate-200 hover:border-slate-400"
                    }">
                      <span class="w-1.5 h-1.5 rounded-full ${isMatched ? "bg-emerald-400" : "bg-slate-700"}"></span>
                      <span>${escapeHtml(s)}</span>
                    </button>
                  `;
                  })
                  .join("")}
              </div>
            </div>
          `
              : ""
          }

          <!-- Documented Career Facts -->
          <div class="space-y-2 pt-2.5 border-t border-slate-100">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">Documented Career Facts (${facts.length})</span>
            </div>
            <ul class="space-y-1.5 text-xs text-slate-800">
              ${facts
                .map(
                  (f) => `
                <li class="flex items-start gap-2 leading-relaxed">
                  <span class="text-slate-400 shrink-0 font-bold">•</span>
                  <span>${escapeHtml(f)}</span>
                </li>
              `
                )
                .join("")}
            </ul>
          </div>
        </div>
      `;
      })
      .join("");

    // Attach Skill Badge filter clicks inside cards
    container.querySelectorAll(".btn-evidence-skill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const skill = btn.getAttribute("data-skill");
        if (state.activeEvidenceSkill && state.activeEvidenceSkill.toLowerCase() === skill.toLowerCase()) {
          state.activeEvidenceSkill = "";
        } else {
          state.activeEvidenceSkill = skill;
        }
        loadEvidenceCatalog($("#input-evidence-search")?.value || "");
      });
    });

    container.querySelectorAll(".btn-complete-role").forEach((button) => {
      button.addEventListener("click", () => {
        $("#interview-company").value = button.dataset.company || "";
        $("#interview-position").value = button.dataset.position || "";
        $("#interview-period").value = button.dataset.period || "";
        $("#modal-interview").classList.remove("hidden");
        $("#interview-facts").focus();
      });
    });

    if (window.lucide) lucide.createIcons();
  }

  async function loadEvidenceCatalog(query = "") {
    const container = $("#evidence-catalog-container");
    if (!container) return;

    try {
      const url = new URL("/api/evidence/catalog", window.location.origin);
      if (query) url.searchParams.set("q", query);
      if (state.activeEvidenceSkill) url.searchParams.set("skill", state.activeEvidenceSkill);
      if (state.activeEvidenceType) url.searchParams.set("type", state.activeEvidenceType);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Could not load the evidence catalog.");
      const data = await res.json();
      state.catalogExperiences = data.experiences || [];
      state.catalogSkills = data.skills || {};
      state.catalogBaseSkills = data.baseSkills || [];
      state.catalogSkillFrequencies = data.skillFrequencies || {};

      renderEvidenceSkills();
      renderEvidenceCards();
    } catch (err) {
      container.innerHTML = `<div class="text-xs text-rose-600 p-4 text-center">Error loading catalog: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadEvidenceBuilder() {
    try {
      renderEvidenceBuilder(await evidenceBuilderApi.status());
    } catch (err) { console.error("Evidence Builder error:", err); }
  }

  async function refreshEvidenceReviewAvailability() {
    const button = $("#btn-resume-evidence-review");
    if (!button) return;
    try {
      const status = await evidenceBuilderApi.status();
      button.classList.toggle("hidden", !status.candidate);
    } catch (err) {
      button.classList.add("hidden");
      console.error("Evidence review availability error:", err);
    }
  }

  function projectAnswerFields() {
    return `<div data-project-answer class="border border-slate-200 rounded p-2 mt-2 space-y-1"><input data-project-name class="w-full text-xs font-normal bg-white border border-slate-300 rounded p-2" placeholder="Project name"><textarea data-project-facts rows="2" class="w-full text-xs font-normal bg-white border border-slate-300 rounded p-2" placeholder="Confirmed facts (one per line)"></textarea><input data-project-skills class="w-full text-xs font-normal bg-white border border-slate-300 rounded p-2" placeholder="Directly used skills (comma-separated)"></div>`;
  }

  function renderEvidenceBuilder(data) {
    const container = $("#evidence-builder-container");
    if (!container) return;
    const report = data.report;
    if (!data.candidate || !report) { container.classList.add("hidden"); return; }
    container.classList.remove("hidden");
    const claims = data.candidate.claims || [];
    const claimReviews = new Map((report.claims || []).map((claim) => [claim.id, claim]));
    const issues = report.issues || [];
    const contexts = new Map((data.candidate.contexts || []).map((context) => [context.id, context]));
    const labelForContext = (contextId) => {
      const context = contexts.get(contextId);
      return context ? [context.position, context.company, context.period].filter(Boolean).join(" · ") : "Your career history";
    };
    const issueLabel = (issue) => ({
      ambiguous_technology: "Confirm the technology used",
      date_conflict: "Confirm the dates for this role",
      source_claim_conflict: "Choose the statement that is accurate",
      answer_conflict: "Choose the detail that is accurate",
    }[issue.type] || "Confirm this career detail");
    const unanswered = (data.candidate.questionnaire?.questions || []).filter((question) => !question.answered);
    const uniqueQuestions = [...new Map(unanswered.map((question) => [`${question.contextId}:${question.key}`, question])).values()];
    const questionsByContext = uniqueQuestions.reduce((groups, question) => {
      (groups[question.contextId] ||= []).push(question);
      return groups;
    }, {});
    const questionFields = (questions) => questions.map((question) => question.key === "projects"
      ? `<div data-project-question="${escapeHtml(question.id)}" class="text-[11px] font-semibold text-slate-700">${escapeHtml(question.prompt)}<p class="font-normal text-slate-500 mt-1">Add each project separately. Facts stay with this role.</p>${projectAnswerFields()}<button type="button" class="btn-add-project-answer mt-2 text-[11px] underline" data-question="${escapeHtml(question.id)}">Add another project</button><label class="mt-2 flex items-center gap-1 font-normal text-slate-600"><input type="checkbox" data-project-unknown="${escapeHtml(question.id)}"> I don't remember a project for this role</label></div>`
      : `<label class="block text-[11px] font-semibold text-slate-700">${escapeHtml(question.prompt)}<textarea data-question="${escapeHtml(question.id)}" rows="2" class="w-full mt-1 text-xs font-normal bg-white border border-slate-300 rounded p-2"></textarea></label>`).join("");
    container.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div><p class="text-[11px] font-bold tracking-wide text-emerald-700 uppercase">Step 3 of 4 · complete your career history</p><h3 class="text-base font-bold text-slate-900">Review your Master Career Profile</h3><p class="text-xs text-slate-500 mt-1">Confirm what we found and add context only where it is useful. Every question is shown with its role.</p><p class="text-[11px] text-slate-500 mt-2">${report.summary.approved} details confirmed · ${issues.filter((issue) => !issue.resolved).length + uniqueQuestions.length} details need attention</p></div>
        <button id="btn-promote-evidence" class="text-xs font-bold px-3 py-1.5 rounded-lg ${report.promotionSafe ? "bg-emerald-700 text-white hover:bg-emerald-800" : "bg-slate-100 text-slate-400 cursor-not-allowed"}" ${report.promotionSafe ? "" : "disabled"}>Confirm Master Career Profile</button>
      </div>
      ${issues.length ? `<section class="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2"><h4 class="font-bold text-amber-950">Details that need confirmation</h4>${issues.map((issue) => `<div class="flex flex-wrap items-center justify-between gap-2 py-1 border-t border-amber-100 first:border-0"><div><p class="font-semibold text-slate-900">${issueLabel(issue)}</p><p class="text-slate-600 mt-0.5">${escapeHtml((issue.values || []).join(" or "))}</p></div>${issue.resolved ? "<span class=\"font-semibold text-emerald-700\">Confirmed</span>" : `<span class="flex items-center gap-2"><select data-issue-value="${escapeHtml(issue.id)}" class="text-[11px] border border-amber-300 rounded px-1.5 py-1 bg-white"><option value="">Choose the accurate value…</option>${(issue.values || []).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select><button data-issue="${escapeHtml(issue.id)}" class="btn-resolve-issue text-[11px] underline font-bold">Confirm</button></span>`}</div>`).join("")}</section>` : ""}
      ${uniqueQuestions.length ? `<section class="space-y-3"><div><h4 class="text-sm font-bold text-slate-900">Complete your career history</h4><p class="text-[11px] text-slate-500 mt-1">Answer only what you can confirm. “I don't remember” is always acceptable.</p></div><div class="grid grid-cols-1 lg:grid-cols-2 gap-3">${Object.entries(questionsByContext).map(([contextId, questions]) => `<div class="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3"><div class="border-b border-slate-200 pb-2"><p class="text-xs font-bold text-slate-900">${escapeHtml(labelForContext(contextId))}</p><p class="text-[11px] text-slate-500">Details for this role</p></div>${questionFields(questions)}</div>`).join("")}</div><button id="btn-submit-builder-answers" class="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 text-white hover:bg-slate-700">Save profile details</button></section>` : ""}
      <section class="space-y-2"><div><h4 class="text-sm font-bold text-slate-900">Imported details</h4><p class="text-[11px] text-slate-500">Keep or remove each detail before confirming your profile.</p></div><div class="space-y-2 max-h-72 overflow-y-auto">${claims.map((claim) => { const actions = claimReviews.get(claim.id)?.allowedActions || []; return `<div class="border border-slate-200 rounded-lg p-3 text-xs"><div class="flex justify-between gap-2"><span class="font-semibold text-slate-900">${escapeHtml(claim.claim)}</span><span class="text-[10px] font-bold text-slate-500">${claim.reviewStatus === "approved" ? "CONFIRMED" : "READY TO REVIEW"}</span></div><p class="text-slate-600 mt-1">${escapeHtml(labelForContext(claim.contextId))}</p>${actions.length ? `<div class="mt-2 flex gap-3">${actions.includes("approve") ? `<button data-claim="${escapeHtml(claim.id)}" data-status="approved" class="btn-review-claim text-[11px] font-bold text-emerald-700">Keep</button>` : ""}${actions.includes("reject") ? `<button data-claim="${escapeHtml(claim.id)}" data-status="rejected" class="btn-review-claim text-[11px] font-bold text-slate-600">Remove</button>` : ""}</div>` : ""}</div>`; }).join("")}</div></section>`;
    container.querySelectorAll(".btn-review-claim").forEach((button) => button.addEventListener("click", async () => {
      try { renderEvidenceBuilder(await evidenceBuilderApi.review({ expectedRevision: data.candidate.revision, decisions: [{ claimId: button.dataset.claim, status: button.dataset.status }] })); }
      catch (error) { alert(error.message || "Review could not be saved."); }
    }));
    container.querySelector("#btn-submit-builder-answers")?.addEventListener("click", async () => {
      const unanswered = data.candidate.questionnaire.questions.filter((question) => !question.answered && container.querySelector(question.key === "projects" ? `[data-project-question="${CSS.escape(question.id)}"]` : `textarea[data-question="${CSS.escape(question.id)}"]`));
      const answers = unanswered.map((question) => {
        if (question.key !== "projects") {
          const field = container.querySelector(`textarea[data-question="${CSS.escape(question.id)}"]`);
          return { questionId: question.id, answer: field?.value || "" };
        }
        const holder = container.querySelector(`[data-project-question="${CSS.escape(question.id)}"]`);
        const projects = [...(holder?.querySelectorAll("[data-project-answer]") || [])].map((group) => ({
          name: group.querySelector("[data-project-name]")?.value.trim() || "",
          facts: (group.querySelector("[data-project-facts]")?.value || "").split("\n").map((fact) => fact.trim()).filter(Boolean),
          skills: (group.querySelector("[data-project-skills]")?.value || "").split(",").map((skill) => skill.trim()).filter(Boolean),
        })).filter((project) => project.name);
        const unknown = holder?.querySelector(`[data-project-unknown="${CSS.escape(question.id)}"]`)?.checked;
        return projects.length ? { questionId: question.id, projects } : unknown ? { questionId: question.id, answer: "unknown" } : null;
      }).filter(Boolean);
      if (!answers.length) return alert("Enter an answer or explicitly mark a project question as unknown before saving.");
      let result;
      try { result = await evidenceBuilderApi.answerQuestionnaire({ expectedRevision: data.candidate.revision, answers }); }
      catch (error) { return alert(error.message || "Answers could not be saved."); }
      showToast("Your profile details were saved for confirmation."); renderEvidenceBuilder(result);
    });
    container.querySelectorAll(".btn-add-project-answer").forEach((button) => button.addEventListener("click", () => {
      const holder = container.querySelector(`[data-project-question="${CSS.escape(button.dataset.question)}"]`);
      button.insertAdjacentHTML("beforebegin", projectAnswerFields());
      holder?.querySelector("[data-project-answer]:last-of-type [data-project-name]")?.focus();
    }));
    container.querySelectorAll(".btn-resolve-issue").forEach((button) => button.addEventListener("click", async () => {
      const issue = issues.find((item) => item.id === button.dataset.issue);
      const selected = container.querySelector(`[data-issue-value="${CSS.escape(issue.id)}"]`)?.value;
      if (!selected) return alert("Choose the value you confirm before resolving this conflict.");
      const decisions = [{ issueId: issue.id, status: "resolved", values: [selected], note: "Confirmed through review." }];
      if (issue.type === "source_claim_conflict") {
        const relatedClaims = claims.filter((claim) => issue.claimIds?.includes(claim.id));
        const selectedClaim = relatedClaims.find((claim) => claim.originalClaim === selected);
        if (!selectedClaim) return alert("The selected statement no longer maps to a claim in this candidate.");
        decisions.push(...relatedClaims.map((claim) => ({ claimId: claim.id, status: claim.id === selectedClaim.id ? "approved" : "rejected", note: "Resolved with the selected source statement." })));
      }
      try { renderEvidenceBuilder(await evidenceBuilderApi.review({ expectedRevision: data.candidate.revision, decisions })); }
      catch (error) { alert(error.message || "Conflict could not be resolved."); }
    }));
    container.querySelector("#btn-promote-evidence")?.addEventListener("click", async () => {
      try { await evidenceBuilderApi.promote({ expectedRevision: data.candidate.revision }); }
      catch (error) { return alert(error.message || "Promotion blocked."); }
      showToast("Your Master Career Profile is confirmed and ready to tailor resumes.");
      container.classList.add("hidden");
      await fetchEvidenceSummary(); await loadEvidenceCatalog(); await refreshEvidenceReviewAvailability();
    });
  }

  async function loadReviewQueue() {
    const container = $("#evidence-queue-container");
    if (!container) return;
    container.innerHTML = `<div class="text-xs text-slate-400 py-6 text-center">Loading details to complete...</div>`;

    try {
      const res = await fetch("/api/evidence/queue");
      const items = await res.json();

      if (!items.length) {
        container.innerHTML = `<div class="p-8 text-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200">There are no extra career details waiting for review. Add details to any role when you want to enrich your profile.</div>`;
        return;
      }

      container.innerHTML = items.map((item) => {
        const isConflict = item.status === "conflict";
        const isApproved = item.status === "approved";
        const isRejected = item.status === "rejected";

        const badgeClass = isApproved
          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
          : isConflict
          ? "bg-rose-100 text-rose-800 border-rose-200"
          : isRejected
          ? "bg-slate-100 text-slate-600 border-slate-200"
          : "bg-amber-100 text-amber-800 border-amber-200";

        return `
          <div class="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-3.5 hover:border-slate-300 transition-colors">
            <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-bold text-slate-900">${escapeHtml(item.company)} — ${escapeHtml(item.position)}</h3>
                  <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${badgeClass}">${item.status}</span>
                </div>
                <p class="text-[11px] text-slate-500 font-mono mt-0.5">${escapeHtml(item.period || "")}</p>
              </div>
              ${item.status === "pending" || item.status === "conflict" ? `
                <div class="flex items-center gap-2 shrink-0">
                  <button class="btn-migrate-queue text-[11px] font-semibold text-slate-700 underline" data-id="${item.id}">Review in profile</button>
                  <button class="btn-reject-queue text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-600" data-id="${item.id}">Remove</button>
                </div>
              ` : ""}
            </div>

            ${isConflict && item.conflictDetails ? `
              <div class="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-900 leading-relaxed">
                <strong>This detail needs confirmation:</strong> ${escapeHtml(item.conflictDetails.message)}
              </div>
            ` : ""}

            <ul class="space-y-1.5 text-xs text-slate-800 leading-relaxed">
              ${(item.facts || []).map((f) => `
                <li class="flex items-start gap-2">
                  <span class="text-slate-400 shrink-0 font-bold">•</span>
                  <span>${escapeHtml(f)}</span>
                </li>
              `).join("")}
            </ul>
          </div>
        `;
      }).join("");

      container.querySelectorAll(".btn-reject-queue").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const id = e.currentTarget.getAttribute("data-id");
          await fetch(`/api/evidence/queue/${id}/reject`, { method: "POST" });
          showToast("Career detail removed.");
          await fetchEvidenceSummary();
          loadReviewQueue();
        });
      });
      container.querySelectorAll(".btn-migrate-queue").forEach((btn) => btn.addEventListener("click", async () => {
        const res = await fetch(`/api/evidence/builder/from-queue/${encodeURIComponent(btn.dataset.id)}`, { method: "POST" });
        const result = await res.json();
        if (!res.ok) return alert(result.error || "Could not migrate queue item.");
        showToast("Your career detail is ready to review in your profile.");
        await loadReviewQueue(); await loadEvidenceBuilder();
      }));

      if (window.lucide) lucide.createIcons();
    } catch (err) {
      container.innerHTML = `<div class="text-xs text-rose-600 p-4 text-center">Unable to load career details: ${err.message}</div>`;
    }
  }

  // -------------------------------------------------------------
  // History & Previous Runs View
  // -------------------------------------------------------------
  function setupHistoryEvents() {
    $("#btn-refresh-history")?.addEventListener("click", () => {
      loadHistoryRuns();
    });
  }

  async function loadHistoryRuns() {
    const container = $("#history-runs-list");
    if (!container) return;
    container.innerHTML = `<div class="text-xs text-slate-400 py-6 text-center">Loading run history...</div>`;

    try {
      const res = await fetch("/api/artifacts/runs");
      const runs = await res.json();

      if (!runs.length) {
        container.innerHTML = `<div class="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-lg border border-slate-200">No previous runs found in output directory.</div>`;
        return;
      }

      container.innerHTML = runs.map((run) => `
        <div class="p-4 bg-slate-50 rounded-lg border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 text-xs hover:border-slate-300 transition-colors">
          <div class="space-y-1 min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-bold text-slate-900 text-sm break-words">${escapeHtml(run.company)}</span>
              <span class="text-slate-600 font-medium break-words">— ${escapeHtml(run.title)}</span>
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border shrink-0 ${run.status === "pass" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-slate-200 text-slate-700 border-slate-300"}">${run.status}</span>
            </div>
            <p class="text-slate-500 text-[11px] font-mono break-all">Directory: output/${escapeHtml(run.companySlug)}/ • Updated: ${new Date(run.updatedAt).toLocaleString()}</p>
          </div>

          <div class="flex flex-wrap items-center gap-2 shrink-0">
            <button class="btn-load-run-to-workspace px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center gap-1 shadow-xs ${state.jobParseInFlight ? "opacity-50 cursor-not-allowed" : ""}" data-slug="${escapeHtml(run.companySlug)}" data-company="${escapeHtml(run.company)}" ${state.jobParseInFlight ? "disabled aria-disabled=\"true\"" : ""}>
              <i data-lucide="arrow-up-right" class="w-3.5 h-3.5"></i>
              <span>Load in Workspace</span>
            </button>
            <a href="/api/artifacts/${run.companySlug}/preview" target="_blank" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-medium flex items-center gap-1 shadow-2xs">
              <span>Preview HTML</span>
              <i data-lucide="external-link" class="w-3 h-3"></i>
            </a>
            ${run.hasPdf ? `
              <a href="/api/artifacts/${run.companySlug}/resume.pdf" target="_blank" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold flex items-center gap-1 shadow-2xs">
                <span>PDF</span>
                <i data-lucide="download" class="w-3 h-3"></i>
              </a>
            ` : ""}
          </div>
        </div>
      `).join("");

      // Wire up Load in Workspace buttons
      container.querySelectorAll(".btn-load-run-to-workspace").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          if (state.jobParseInFlight) return;
          const slug = e.currentTarget.getAttribute("data-slug");
          const company = e.currentTarget.getAttribute("data-company");
          state.currentRun = { companySlug: slug, company };
          // Switch to workspace view and preview stage
          $("#nav-workspace")?.click();
          loadArtifactsPreview();
        });
      });

      if (window.lucide) lucide.createIcons();
      setJobParseInFlight(state.jobParseInFlight);
    } catch (err) {
      container.innerHTML = `<div class="text-xs text-rose-600 p-4 text-center">Error loading runs: ${err.message}</div>`;
    }
  }

  // -------------------------------------------------------------
  // Settings & Configuration Form
  // -------------------------------------------------------------
  function setupSettingsEvents() {
    $("#btn-rerun-doctor")?.addEventListener("click", () => refreshDoctorStatus());

    // Password visibility toggle
    $("#btn-toggle-key-visibility")?.addEventListener("click", () => {
      const input = $("#settings-gemini-key");
      if (!input) return;
      if (input.type === "password") {
        input.type = "text";
      } else {
        input.type = "password";
      }
    });

    $("#btn-save-settings")?.addEventListener("click", async () => {
      const alertBox = $("#settings-save-alert");
      const saveButton = $("#btn-save-settings");
      if (!alertBox) return;
      alertBox.classList.add("hidden");
      saveButton.disabled = true;
      saveButton.setAttribute("aria-busy", "true");
      saveButton.classList.add("opacity-60", "cursor-wait");
      const saveLabel = saveButton.querySelector("span");
      const originalSaveLabel = saveLabel?.textContent;
      if (saveLabel) saveLabel.textContent = "Saving...";

      const provider = $("#settings-llm-provider").value;
      const geminiKey = $("#settings-gemini-key").value.trim();
      const ollamaModel = $("#settings-ollama-model").value.trim();
      const ollamaUrl = $("#settings-ollama-url").value.trim();
      const rewriteEnabled = $("#settings-pipeline-rewrite").checked;
      const maxBullets = Number.parseInt($("#settings-max-bullets").value, 10) || 4;

      const updates = {
        llm: {
          provider,
          gemini: geminiKey ? { apiKey: geminiKey } : undefined,
          ollama: {
            model: ollamaModel,
            url: ollamaUrl,
          },
        },
        pipeline: {
          rewriteEnabled,
          maxBulletsPerRole: maxBullets,
        },
      };

      try {
        const res = await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Save failed");
        }

        const data = await res.json();
        state.config = data.config;
        alertBox.textContent = "Configuration saved safely to cv-tailor.config.json.";
        alertBox.className = "p-3 rounded-lg text-xs bg-emerald-50 text-emerald-800 border border-emerald-200";
        alertBox.classList.remove("hidden");

        loadSettingsForm();
      } catch (err) {
        alertBox.textContent = `Error saving settings: ${err.message}`;
        alertBox.className = "p-3 rounded-lg text-xs bg-rose-50 text-rose-800 border border-rose-200";
        alertBox.classList.remove("hidden");
      } finally {
        saveButton.disabled = false;
        saveButton.removeAttribute("aria-busy");
        saveButton.classList.remove("opacity-60", "cursor-wait");
        if (saveLabel && originalSaveLabel) saveLabel.textContent = originalSaveLabel;
      }
    });
  }

  function loadSettingsForm() {
    loadSettingsDoctorSection();

    if (!state.config) return;
    const cfg = state.config;

    if (cfg.llm?.provider && $("#settings-llm-provider")) {
      $("#settings-llm-provider").value = cfg.llm.provider;
    }

    if (cfg.llm?.ollama?.model && $("#settings-ollama-model")) {
      $("#settings-ollama-model").value = cfg.llm.ollama.model;
    }
    if (cfg.llm?.ollama?.url && $("#settings-ollama-url")) {
      $("#settings-ollama-url").value = cfg.llm.ollama.url;
    }

    if ($("#settings-pipeline-rewrite")) {
      $("#settings-pipeline-rewrite").checked = Boolean(cfg.pipeline?.rewriteEnabled);
    }
    if ($("#settings-max-bullets")) {
      $("#settings-max-bullets").value = cfg.pipeline?.maxBulletsPerRole || 4;
    }
  }

  function loadSettingsDoctorSection() {
    const container = $("#doctor-checks-container");
    if (!container) return;
    if (state.doctorCheckInFlight) {
      container.innerHTML = `<div class="text-xs text-slate-500 p-4 text-center" role="status" aria-live="polite">Checking environment diagnostics...</div>`;
      return;
    }
    if (!state.doctorReport || !state.doctorReport.checks) return;

    container.innerHTML = state.doctorReport.checks.map((c) => `
      <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
        <div>
          <span class="font-bold text-slate-800">${escapeHtml(c.label)}:</span>
          <span class="text-slate-600 ml-1">${escapeHtml(c.message)}</span>
        </div>
        <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${c.status === "pass" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : c.status === "warn" ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-rose-100 text-rose-800 border-rose-200"}">${c.status}</span>
      </div>
    `).join("");
  }

  // -------------------------------------------------------------
  // Modals Keyboard & Backdrop Handlers
  // -------------------------------------------------------------
  function setupModalKeyEvents() {
    // Close modals on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        $("#modal-interview")?.classList.add("hidden");
        $("#modal-add-experience")?.classList.add("hidden");
        $("#modal-doctor-details")?.classList.add("hidden");
      }
    });

    // Close on clicking backdrop
    [
      { modal: $("#modal-interview"), boxSelector: ".modal-content-box" },
      { modal: $("#modal-add-experience"), boxSelector: ".modal-content-box" },
      { modal: $("#modal-build-evidence"), boxSelector: ".modal-content-box" },
      { modal: $("#modal-doctor-details"), boxSelector: ".modal-content-box" },
    ].forEach(({ modal, boxSelector }) => {
      if (!modal) return;
      modal.addEventListener("click", (e) => {
        if (!e.target.closest(boxSelector)) {
          modal.classList.add("hidden");
        }
      });
    });
  }

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------
  function updateStepIndicators(stepNumber) {
    for (let i = 1; i <= 5; i++) {
      const ind = $(`#step-ind-${i}`);
      if (!ind) continue;
      const span = ind.querySelector("span");
      if (i < stepNumber) {
        ind.className = "step-badge completed clickable flex items-center gap-1.5 font-medium px-2.5 sm:px-3 py-1.5 rounded-full text-slate-700 bg-slate-100 whitespace-nowrap shrink-0";
        if (span) span.className = "w-4 h-4 rounded-full bg-slate-200 text-center leading-4 text-[10px] font-bold text-slate-700";
      } else if (i === stepNumber) {
        ind.className = "step-badge active clickable flex items-center gap-1.5 font-medium px-2.5 sm:px-3 py-1.5 rounded-full bg-slate-900 text-white whitespace-nowrap shrink-0 shadow-xs";
        if (span) span.className = "w-4 h-4 rounded-full bg-white/25 text-center leading-4 text-[10px] font-bold text-white";
      } else {
        ind.className = "step-badge clickable flex items-center gap-1.5 font-medium px-2.5 sm:px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap shrink-0";
        if (span) span.className = "w-4 h-4 rounded-full bg-slate-200 text-center leading-4 text-[10px] font-bold text-slate-600";
      }
    }
  }

  function showToast(message) {
    const existing = $(".cv-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "cv-toast fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-xs font-semibold flex items-center gap-2 border border-slate-700 animate-bounce";
    toast.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i> <span>${escapeHtml(message)}</span>`;
    document.body.appendChild(toast);

    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 300ms ease";
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  function escapeHtml(str) {
    if (!str || typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function slugify(text) {
    return String(text)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getSampleJobText() {
    return `Flash is seeking a Senior Backend Engineer to join our Core Services team.

Responsibilities:
- Design, build, and maintain high-throughput distributed microservices in Node.js and TypeScript.
- Architect scalable event-driven data pipelines using Redis, Kafka, and RabbitMQ.
- Optimize database queries and schema designs for PostgreSQL and MongoDB.
- Collaborate with infrastructure teams on Kubernetes container deployments and Helm charts.
- Mentor junior engineers and champion domain-driven design principles.

Qualifications:
- 5+ years building backend systems using Node.js and TypeScript.
- Extensive experience designing RESTful APIs and gRPC microservices.
- Proven track record with distributed caching, message brokers, and relational databases.
- Strong grounding in unit testing, CI/CD automation, and observability (Prometheus/Grafana).

Preferred:
- Experience with Go or Rust in high-concurrency environments.
- Knowledge of cloud architecture on AWS or GCP.
- Contributions to open-source software libraries.`;
  }

  // Start app
  document.addEventListener("DOMContentLoaded", init);
})();
