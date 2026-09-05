import fs from "node:fs/promises";

const [resumePath, planPath, outputPath = "output/flash/ats-report.json"] =
  process.argv.slice(2);

if (!resumePath || !planPath) {
  console.error(
    "Usage: node scripts/ats-validate.mjs <resume-final.json> <tailoring-plan.json> [ats-report.json]"
  );
  process.exit(1);
}

const resume = JSON.parse(await fs.readFile(resumePath, "utf8"));

const plan = JSON.parse(await fs.readFile(planPath, "utf8"));

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}+#.%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values)];
}

function phraseExists(phrase, text) {
  const needle = normalize(phrase);

  const haystack = normalize(text);

  if (!needle || !haystack) {
    return false;
  }

  return ` ${haystack} `.includes(` ${needle} `);
}

function pushIssue(collection, code, message, details = null) {
  collection.push({
    code,
    message,
    ...(details ? { details } : {}),
  });
}

/*
 * ----------------------------------------
 * Canonical term handling
 * ----------------------------------------
 */

const aliasGroups = [
  ["REST", "REST API", "REST APIs", "RESTful API", "RESTful APIs"],

  ["RPC", "gRPC"],

  [
    "GCP",
    "Google Cloud",
    "Google Cloud Platform",
    "Google Cloud Platform (GCP)",
  ],

  ["CI/CD", "GitLab CI", "Continuous Integration"],

  ["DDD", "Domain-Driven Design", "Domain Driven Design"],

  ["Event-Driven Architecture", "Event-Driven", "event-driven"],

  ["Automated Testing", "Unit Testing", "Unit Tests"],

  ["Mentoring", "Mentor", "Mentored"],

  ["Technical Leadership", "Team Lead", "Development Lead"],

  ["Code Reviews", "Code Review"],

  ["Scalable Systems", "Scalability", "Scalable"],

  [
    "Performance Metrics",
    "Performance",
    "Page Loading Time",
    "Request Performance",
  ],

  ["Reliability", "Availability", "Quality Gates"],
];

function canonicalTerm(value) {
  const normalized = normalize(value);

  for (const group of aliasGroups) {
    if (group.some((item) => normalize(item) === normalized)) {
      return normalize(group[0]);
    }
  }

  return normalized;
}

function termExists(term, text) {
  const canonical = canonicalTerm(term);

  for (const group of aliasGroups) {
    const canonicalGroup = canonicalTerm(group[0]);

    if (canonicalGroup !== canonical) {
      continue;
    }

    return group.some((alias) => phraseExists(alias, text));
  }

  return phraseExists(term, text);
}

/*
 * ----------------------------------------
 * Resume text representations
 * ----------------------------------------
 */

const summary = resume.basics?.summary ?? "";

const workText = (resume.work ?? [])
  .flatMap((work) => work.highlights ?? [])
  .join(" ");

const skillsText = (resume.skills ?? [])
  .flatMap((skill) => [skill.name, skill.level, ...(skill.keywords ?? [])])
  .filter(Boolean)
  .join(" ");

const certificatesText = (resume.certificates ?? [])
  .flatMap((certificate) => [certificate.name, certificate.issuer])
  .filter(Boolean)
  .join(" ");

const educationText = (resume.education ?? [])
  .flatMap((education) => [
    education.institution,
    education.area,
    education.studyType,
  ])
  .filter(Boolean)
  .join(" ");

const fullResumeText = [
  resume.basics?.name,
  resume.basics?.label,
  summary,
  workText,
  skillsText,
  certificatesText,
  educationText,
]
  .filter(Boolean)
  .join(" ");

/*
 * ----------------------------------------
 * Result containers
 * ----------------------------------------
 */

const errors = [];
const warnings = [];
const info = [];

/*
 * ----------------------------------------
 * Basics
 * ----------------------------------------
 */

if (!resume.basics?.name) {
  pushIssue(errors, "missing_name", "Candidate name is missing.");
}

if (!resume.basics?.label) {
  pushIssue(
    warnings,
    "missing_professional_label",
    "Professional title/label is missing."
  );
}

if (!resume.basics?.email) {
  pushIssue(errors, "missing_email", "Email address is missing.");
}

if (!resume.basics?.phone) {
  pushIssue(warnings, "missing_phone", "Phone number is missing.");
}

const linkedinProfile = (resume.basics?.profiles ?? []).find(
  (profile) => normalize(profile.network) === "linkedin"
);

if (!linkedinProfile) {
  pushIssue(warnings, "missing_linkedin", "LinkedIn profile is missing.");
} else if (!linkedinProfile.url) {
  pushIssue(
    warnings,
    "linkedin_missing_url",
    "LinkedIn profile exists but does not contain a URL."
  );
}

/*
 * ----------------------------------------
 * Summary
 * ----------------------------------------
 */

const summaryWords = summary.trim().split(/\s+/).filter(Boolean);

if (!summary) {
  pushIssue(warnings, "missing_summary", "Professional summary is missing.");
} else {
  if (summaryWords.length < 25) {
    pushIssue(
      warnings,
      "summary_too_short",
      `Summary contains only ${summaryWords.length} words.`
    );
  }

  if (summaryWords.length > 100) {
    pushIssue(
      warnings,
      "summary_too_long",
      `Summary contains ${summaryWords.length} words.`
    );
  }
}

/*
 * ----------------------------------------
 * Work experience
 * ----------------------------------------
 */

if (!Array.isArray(resume.work) || resume.work.length === 0) {
  pushIssue(errors, "missing_work", "Work experience section is missing.");
}

for (const work of resume.work ?? []) {
  const label = `${work.name ?? "Unknown company"} — ${work.position ?? "Unknown position"}`;

  if (!work.name) {
    pushIssue(
      errors,
      "work_missing_company",
      "A work entry is missing its company name.",
      {
        position: work.position ?? null,
      }
    );
  }

  if (!work.position) {
    pushIssue(
      errors,
      "work_missing_position",
      "A work entry is missing its job title.",
      {
        company: work.name ?? null,
      }
    );
  }

  if (!work.startDate) {
    pushIssue(
      warnings,
      "work_missing_start_date",
      `${label} is missing a start date.`
    );
  }

  if (Array.isArray(work.highlights) && work.highlights.length === 0) {
    pushIssue(
      warnings,
      "work_without_highlights",
      `${label} has no achievement/responsibility bullets.`
    );
  }

  for (const highlight of work.highlights ?? []) {
    const wordCount = String(highlight)
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

    if (wordCount > 45) {
      pushIssue(
        warnings,
        "long_bullet",
        `${label} contains a long bullet (${wordCount} words).`,
        {
          bullet: highlight,
        }
      );
    }

    if (wordCount < 5) {
      pushIssue(
        warnings,
        "short_bullet",
        `${label} contains a very short bullet (${wordCount} words).`,
        {
          bullet: highlight,
        }
      );
    }
  }
}

/*
 * ----------------------------------------
 * Date parsing
 * ----------------------------------------
 */

function parseResumeDate(value) {
  if (!value) {
    return null;
  }

  const raw = String(value);

  if (/^\d{4}$/.test(raw)) {
    return {
      year: Number(raw),

      month: null,

      day: null,
    };
  }

  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split("-").map(Number);

    return {
      year,
      month,
      day: null,
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);

    return {
      year,
      month,
      day,
    };
  }

  return null;
}

function validateDateValue(value, context) {
  if (!value) {
    return;
  }

  const parsed = parseResumeDate(value);

  if (!parsed) {
    pushIssue(
      errors,
      "invalid_date_format",
      `${context} has unsupported date format: ${value}`
    );

    return;
  }

  if (parsed.month !== null && (parsed.month < 1 || parsed.month > 12)) {
    pushIssue(
      errors,
      "invalid_month",
      `${context} contains invalid month: ${value}`
    );
  }

  if (parsed.day !== null && (parsed.day < 1 || parsed.day > 31)) {
    pushIssue(
      errors,
      "invalid_day",
      `${context} contains invalid day: ${value}`
    );
  }
}

for (const work of resume.work ?? []) {
  validateDateValue(
    work.startDate,
    `${work.name} — ${work.position} startDate`
  );

  validateDateValue(work.endDate, `${work.name} — ${work.position} endDate`);

  if (work.endDate === "") {
    pushIssue(
      errors,
      "empty_end_date",
      `${work.name} — ${work.position} uses an empty endDate. Omit endDate for current roles.`
    );
  }
}

for (const education of resume.education ?? []) {
  validateDateValue(education.startDate, `${education.institution} startDate`);

  validateDateValue(education.endDate, `${education.institution} endDate`);
}

/*
 * ----------------------------------------
 * Date overlap detection
 * ----------------------------------------
 */

function dateToSortable(value, isEnd = false) {
  const parsed = parseResumeDate(value);

  if (!parsed) {
    return null;
  }

  const month = parsed.month ?? (isEnd ? 12 : 1);

  const day = parsed.day ?? (isEnd ? 31 : 1);

  return parsed.year * 10000 + month * 100 + day;
}

const workEntriesWithDates = (resume.work ?? [])
  .map((work) => ({
    ...work,

    startSort: dateToSortable(work.startDate, false),

    endSort: work.endDate ? dateToSortable(work.endDate, true) : Infinity,
  }))
  .filter((work) => work.startSort !== null);

for (let i = 0; i < workEntriesWithDates.length; i++) {
  for (let j = i + 1; j < workEntriesWithDates.length; j++) {
    const a = workEntriesWithDates[i];

    const b = workEntriesWithDates[j];

    const overlap = a.startSort <= b.endSort && b.startSort <= a.endSort;

    if (!overlap) {
      continue;
    }

    /*
     * Current job overlapping historical job by
     * one month can be legitimate during transitions.
     * We still report it for manual review.
     */
    pushIssue(
      warnings,
      "work_date_overlap",
      `Work dates overlap: ${a.name} — ${a.position} (${a.startDate} to ${a.endDate ?? "present"}) and ${b.name} — ${b.position} (${b.startDate} to ${b.endDate ?? "present"}).`
    );
  }
}

/*
 * ----------------------------------------
 * Skills
 * ----------------------------------------
 */

if (!Array.isArray(resume.skills) || resume.skills.length === 0) {
  pushIssue(warnings, "missing_skills", "Skills section is missing.");
}

const seenSkillKeywords = new Map();

for (const skill of resume.skills ?? []) {
  if (!skill.name) {
    pushIssue(
      warnings,
      "skill_group_without_name",
      "A skill group has no name."
    );
  }

  for (const keyword of skill.keywords ?? []) {
    const canonical = canonicalTerm(keyword);

    if (seenSkillKeywords.has(canonical)) {
      pushIssue(
        warnings,
        "duplicate_skill_keyword",
        `Skill keyword appears in more than one place: ${keyword}`,
        {
          firstGroup: seenSkillKeywords.get(canonical),

          duplicateGroup: skill.name,
        }
      );
    } else {
      seenSkillKeywords.set(canonical, skill.name);
    }
  }
}

/*
 * ----------------------------------------
 * Target requirement coverage
 * ----------------------------------------
 */

const planTerms = [];

for (const categoryName of ["required", "preferred", "competencies"]) {
  const values = plan.job?.[categoryName];

  if (Array.isArray(values)) {
    for (const term of values) {
      planTerms.push({
        term,
        category: categoryName,
      });
    }
  }
}

/*
 * Fallback to globalCoverage if job arrays
 * are not available in the plan.
 */
if (planTerms.length === 0) {
  for (const item of plan.globalCoverage ?? []) {
    planTerms.push({
      term: item.term,

      category: item.category ?? "unknown",
    });
  }
}

const keywordCoverage = planTerms.map((item) => {
  const inSummary = termExists(item.term, summary);

  const inWork = termExists(item.term, workText);

  const inSkills = termExists(item.term, skillsText);

  const inCertificates = termExists(item.term, certificatesText);

  const found = inSummary || inWork || inSkills || inCertificates;

  return {
    term: item.term,

    category: item.category,

    found,

    locations: [
      ...(inSummary ? ["summary"] : []),

      ...(inWork ? ["work"] : []),

      ...(inSkills ? ["skills"] : []),

      ...(inCertificates ? ["certificates"] : []),
    ],
  };
});

const requiredCoverage = keywordCoverage.filter(
  (item) => normalize(item.category) === "required"
);

const preferredCoverage = keywordCoverage.filter(
  (item) => normalize(item.category) === "preferred"
);

const competencyCoverage = keywordCoverage.filter((item) =>
  ["competency", "competencies"].includes(normalize(item.category))
);

function coveragePercent(items) {
  if (items.length === 0) {
    return null;
  }

  const found = items.filter((item) => item.found).length;

  return Math.round((found / items.length) * 100);
}

for (const item of requiredCoverage) {
  if (!item.found) {
    pushIssue(
      warnings,
      "missing_required_keyword",
      `Required job term not found in final resume: ${item.term}`
    );
  }
}

for (const item of preferredCoverage) {
  if (!item.found) {
    pushIssue(
      info,
      "missing_preferred_keyword",
      `Preferred job term not found in final resume: ${item.term}`
    );
  }
}

/*
 * ----------------------------------------
 * Unsupported / unsafe terms
 * ----------------------------------------
 */

const unsupportedTerms = (plan.safety?.unsupportedTerms ?? [])
  .map((item) => (typeof item === "string" ? item : item.term))
  .filter(Boolean);

for (const term of unsupportedTerms) {
  if (phraseExists(term, fullResumeText)) {
    pushIssue(
      errors,
      "unsupported_term_present",
      `Unsupported term appears in final resume: ${term}`
    );
  }
}

/*
 * ----------------------------------------
 * Familiarity-sensitive terms
 * ----------------------------------------
 */

for (const skill of resume.skills ?? []) {
  if (normalize(skill.level) !== "familiar") {
    continue;
  }

  for (const keyword of skill.keywords ?? []) {
    if (termExists(keyword, workText)) {
      pushIssue(
        warnings,
        "familiar_term_in_work",
        `${keyword} is marked Familiar in skills but also appears in work experience. Verify the claimed depth.`
      );
    }
  }
}

/*
 * ----------------------------------------
 * Keyword density
 * ----------------------------------------
 */

const targetTermsFound = keywordCoverage.filter((item) => item.found);

const termLocationCounts = targetTermsFound.map((item) => ({
  term: item.term,

  occurrences: [summary, workText, skillsText, certificatesText].reduce(
    (count, text) => count + (termExists(item.term, text) ? 1 : 0),
    0
  ),
}));

for (const item of termLocationCounts) {
  if (item.occurrences >= 4) {
    pushIssue(
      info,
      "keyword_repeated_across_sections",
      `${item.term} appears across many resume sections. Verify that repetition still reads naturally.`
    );
  }
}

/*
 * ----------------------------------------
 * Education / certificates / languages
 * ----------------------------------------
 */

if (!Array.isArray(resume.education) || resume.education.length === 0) {
  pushIssue(warnings, "missing_education", "Education section is missing.");
}

if (!Array.isArray(resume.languages) || resume.languages.length === 0) {
  pushIssue(info, "missing_languages", "Languages section is missing.");
}

/*
 * ----------------------------------------
 * ATS-friendly structural heuristics
 * ----------------------------------------
 */

if (/[★●◆■▶✓✔]/u.test(fullResumeText)) {
  pushIssue(
    warnings,
    "decorative_symbols",
    "Resume content contains decorative symbols that may parse inconsistently."
  );
}

if (/[\u{1F300}-\u{1FAFF}]/u.test(fullResumeText)) {
  pushIssue(warnings, "emoji_detected", "Resume content contains emoji.");
}

/*
 * ----------------------------------------
 * Specific current resume checks
 * ----------------------------------------
 */

/*
 * gRPC is professionally supported in work.
 * It is useful enough for this target job that
 * absence from skills deserves a warning.
 */
if (termExists("gRPC", workText) && !termExists("gRPC", skillsText)) {
  pushIssue(
    warnings,
    "grpc_missing_from_skills",
    "gRPC appears in professional experience but not in the skills section."
  );
}

/*
 * Full phrase is usually better ATS text
 * than acronym-only DDD in work bullets.
 */
if (
  phraseExists("DDD", workText) &&
  !phraseExists("Domain-Driven Design", workText)
) {
  pushIssue(
    info,
    "ddd_acronym_only_in_work",
    "Work experience uses DDD without the full phrase Domain-Driven Design. The full phrase exists in skills, but explicit wording in work may improve readability and keyword matching."
  );
}

/*
 * ----------------------------------------
 * Scores
 * ----------------------------------------
 */

const structuralChecks = [
  Boolean(resume.basics?.name),

  Boolean(resume.basics?.email),

  Boolean(resume.basics?.phone),

  Boolean(summary),

  Array.isArray(resume.work) && resume.work.length > 0,

  Array.isArray(resume.skills) && resume.skills.length > 0,

  Array.isArray(resume.education) && resume.education.length > 0,
];

const structureScore = Math.round(
  (structuralChecks.filter(Boolean).length / structuralChecks.length) * 100
);

const requiredScore = coveragePercent(requiredCoverage);

const preferredScore = coveragePercent(preferredCoverage);

const competencyScore = coveragePercent(competencyCoverage);

/*
 * This is deliberately not called an ATS score.
 * It is an internal readiness indicator.
 */
const readinessComponents = [
  structureScore,

  ...(requiredScore !== null ? [requiredScore] : []),

  ...(preferredScore !== null ? [preferredScore] : []),

  ...(competencyScore !== null ? [competencyScore] : []),
];

const readiness =
  readinessComponents.length > 0
    ? Math.round(
        readinessComponents.reduce((sum, value) => sum + value, 0) /
          readinessComponents.length
      )
    : null;

/*
 * ----------------------------------------
 * Report
 * ----------------------------------------
 */

const report = {
  generatedAt: new Date().toISOString(),

  resume: resumePath,

  target: {
    company: plan.job?.company ?? null,

    title: plan.job?.title ?? null,
  },

  readiness: {
    /*
     * Internal heuristic only.
     * Not a claim about any commercial ATS.
     */
    overall: readiness,

    structure: structureScore,

    requiredKeywordCoverage: requiredScore,

    preferredKeywordCoverage: preferredScore,

    competencyCoverage: competencyScore,
  },

  counts: {
    errors: errors.length,

    warnings: warnings.length,

    info: info.length,
  },

  keywordCoverage,

  errors,

  warnings,

  info,
};

await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");

/*
 * ----------------------------------------
 * Console output
 * ----------------------------------------
 */

console.log("\nATS VALIDATION");

console.log("==============");

console.log(
  `Target: ${report.target.company ?? "unknown"} — ${report.target.title ?? "unknown"}`
);

console.log(`Internal readiness: ${readiness ?? "n/a"}%`);

console.log(`Structure: ${structureScore}%`);

if (requiredScore !== null) {
  console.log(`Required keyword coverage: ${requiredScore}%`);
}

if (preferredScore !== null) {
  console.log(`Preferred keyword coverage: ${preferredScore}%`);
}

if (competencyScore !== null) {
  console.log(`Competency coverage: ${competencyScore}%`);
}

console.log(`\nErrors: ${errors.length}`);

for (const issue of errors) {
  console.log(`  ✗ [${issue.code}] ${issue.message}`);
}

console.log(`\nWarnings: ${warnings.length}`);

for (const issue of warnings) {
  console.log(`  ! [${issue.code}] ${issue.message}`);
}

console.log(`\nInfo: ${info.length}`);

for (const issue of info) {
  console.log(`  · [${issue.code}] ${issue.message}`);
}

console.log(`\nReport: ${outputPath}`);

if (errors.length > 0) {
  process.exitCode = 1;
}
