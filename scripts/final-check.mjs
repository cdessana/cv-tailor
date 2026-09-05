import fs from "node:fs/promises";

const [resumePath, planPath, outputPath = "output/flash/final-check.json"] =
  process.argv.slice(2);

if (!resumePath || !planPath) {
  console.error(
    "Usage: node scripts/final-check.mjs <resume-final.json> <tailoring-plan.json> [output.json]"
  );
  process.exit(1);
}

const resume = JSON.parse(await fs.readFile(resumePath, "utf8"));

const plan = JSON.parse(await fs.readFile(planPath, "utf8"));

/*
 * ----------------------------------------
 * Helpers
 * ----------------------------------------
 */

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
 * Alias handling
 * ----------------------------------------
 */

const aliasGroups = [
  ["REST APIs", "REST", "REST API", "RESTful API", "RESTful APIs"],

  ["RPC", "gRPC"],

  [
    "GCP",
    "Google Cloud",
    "Google Cloud Platform",
    "Google Cloud Platform (GCP)",
  ],

  ["CI/CD", "GitLab CI", "Continuous Integration"],

  ["Domain-Driven Design", "DDD", "Domain Driven Design"],

  ["Event-Driven Architecture", "Event-Driven", "event-driven"],

  ["Automated Testing", "Unit Testing", "Unit Tests"],

  ["Mentoring", "Mentor", "Mentored"],

  ["Technical Leadership", "Team Lead", "Development Lead"],

  ["Code Reviews", "Code Review"],

  ["Scalable Systems", "Scalability", "Scalable"],
];

function aliasesFor(term) {
  const normalized = normalize(term);

  for (const group of aliasGroups) {
    if (group.some((item) => normalize(item) === normalized)) {
      return group;
    }
  }

  return [term];
}

function termExists(term, text) {
  return aliasesFor(term).some((alias) => phraseExists(alias, text));
}

/*
 * ----------------------------------------
 * Resume text
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

const fullResumeText = [
  resume.basics?.name,
  resume.basics?.label,
  summary,
  workText,
  skillsText,
  certificatesText,
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
 * 1. Unsupported terms
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
 * 2. Target coverage
 * ----------------------------------------
 */

const coverageItems = plan.globalCoverage ?? [];

const coverage = coverageItems.map((item) => {
  const inSummary = termExists(item.term, summary);

  const inWork = termExists(item.term, workText);

  const inSkills = termExists(item.term, skillsText);

  const inCertificates = termExists(item.term, certificatesText);

  return {
    term: item.term,

    category: item.category,

    expectedStatus: item.status,

    found: inSummary || inWork || inSkills || inCertificates,

    locations: [
      ...(inSummary ? ["summary"] : []),

      ...(inWork ? ["work"] : []),

      ...(inSkills ? ["skills"] : []),

      ...(inCertificates ? ["certificates"] : []),
    ],
  };
});

for (const item of coverage) {
  const category = normalize(item.category);

  if (category === "required" && !item.found) {
    pushIssue(
      warnings,
      "required_term_missing",
      `Supported required term is missing from final resume: ${item.term}`
    );
  }

  if (category === "preferred" && !item.found) {
    pushIssue(
      info,
      "preferred_term_missing",
      `Supported preferred term is missing from final resume: ${item.term}`
    );
  }
}

/*
 * ----------------------------------------
 * 3. Familiarity vs professional claim
 * ----------------------------------------
 */

const familiarTerms = (resume.skills ?? [])
  .filter((skill) => normalize(skill.level) === "familiar")
  .flatMap((skill) => skill.keywords ?? []);

for (const term of familiarTerms) {
  if (termExists(term, workText)) {
    pushIssue(
      warnings,
      "familiarity_depth_conflict",
      `${term} is marked Familiar in skills but also appears in work experience. Verify that the professional claim is intentional.`
    );
  }

  if (termExists(term, summary)) {
    pushIssue(
      warnings,
      "familiarity_in_summary",
      `${term} is marked Familiar but appears in the professional summary.`
    );
  }
}

/*
 * ----------------------------------------
 * 4. React certification boundary
 * ----------------------------------------
 */

const hasReactCertificate = termExists("React", certificatesText);

if (hasReactCertificate) {
  if (termExists("React", workText)) {
    pushIssue(
      warnings,
      "react_professional_claim",
      "React appears in work experience, but current evidence supports it through certification rather than verified professional experience."
    );
  }

  if (termExists("React", summary)) {
    pushIssue(
      warnings,
      "react_summary_claim",
      "React appears in the summary, but current evidence supports it through certification rather than verified professional experience."
    );
  }
}

/*
 * ----------------------------------------
 * 5. Known unsupported career claims
 * ----------------------------------------
 */

const hardBlockedProfessionalTerms = [
  "AWS",
  "GraphQL",
  "RDS",
  "NestJS",
  "React Native",
  "Azure",
  "SLAs",
];

for (const term of hardBlockedProfessionalTerms) {
  if (
    termExists(term, summary) ||
    termExists(term, workText) ||
    termExists(term, skillsText)
  ) {
    pushIssue(
      errors,
      "hard_blocked_claim",
      `${term} appears as a professional claim but is not currently supported by verified evidence.`
    );
  }
}

/*
 * ----------------------------------------
 * 6. Important verified skills missing
 * ----------------------------------------
 */

const importantVerifiedSkills = [
  {
    term: "gRPC",

    reason:
      "Professional Sidia evidence exists and RPC is required by the target role.",
  },

  {
    term: "Node.js",

    reason:
      "Professional Sidia evidence exists and Node.js is required by the target role.",
  },

  {
    term: "MongoDB",

    reason:
      "Professional Sidia evidence exists and MongoDB is required by the target role.",
  },

  {
    term: "CI/CD",

    reason:
      "Professional Sidia evidence exists and CI/CD is preferred by the target role.",
  },
];

for (const item of importantVerifiedSkills) {
  if (termExists(item.term, workText) && !termExists(item.term, skillsText)) {
    pushIssue(
      warnings,
      "verified_skill_missing_from_skills",
      `${item.term} is supported by professional experience but missing from the skills section.`,
      {
        reason: item.reason,
      }
    );
  }
}

/*
 * ----------------------------------------
 * 7. DDD explicit wording
 * ----------------------------------------
 */

if (
  phraseExists("DDD", workText) &&
  !phraseExists("Domain-Driven Design", workText)
) {
  pushIssue(
    info,
    "ddd_acronym_only_in_work",
    "Work experience uses DDD without spelling out Domain-Driven Design. The full term in work experience may improve readability and keyword matching."
  );
}

/*
 * ----------------------------------------
 * 8. Empty historical roles
 * ----------------------------------------
 */

for (const work of resume.work ?? []) {
  if (Array.isArray(work.highlights) && work.highlights.length === 0) {
    pushIssue(
      warnings,
      "empty_role",
      `${work.name} — ${work.position} has no highlights.`
    );
  }
}

/*
 * ----------------------------------------
 * 9. Date checks
 * ----------------------------------------
 */

function parseDate(value) {
  if (!value) {
    return null;
  }

  const match = String(value).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);

  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),

    month: match[2] ? Number(match[2]) : null,

    day: match[3] ? Number(match[3]) : null,
  };
}

function dateSortValue(value, { end = false } = {}) {
  const parsed = parseDate(value);

  if (!parsed) {
    return null;
  }

  const month = parsed.month ?? (end ? 12 : 1);

  const day = parsed.day ?? (end ? 31 : 1);

  return parsed.year * 10000 + month * 100 + day;
}

for (const work of resume.work ?? []) {
  const label = `${work.name} — ${work.position}`;

  if (work.endDate === "") {
    pushIssue(
      errors,
      "empty_end_date",
      `${label} has endDate set to an empty string. Current roles should omit endDate.`
    );
  }

  if (work.startDate && !parseDate(work.startDate)) {
    pushIssue(
      warnings,
      "invalid_start_date",
      `${label} has an unsupported start date format: ${work.startDate}`
    );
  }

  if (work.endDate && !parseDate(work.endDate)) {
    pushIssue(
      warnings,
      "invalid_end_date",
      `${label} has an unsupported end date format: ${work.endDate}`
    );
  }
}

/*
 * ----------------------------------------
 * 10. Work overlaps
 * ----------------------------------------
 */

const datedWork = (resume.work ?? [])
  .map((work) => ({
    ...work,

    startSort: dateSortValue(work.startDate),

    endSort: work.endDate
      ? dateSortValue(work.endDate, { end: true })
      : Infinity,
  }))
  .filter((work) => work.startSort !== null);

for (let i = 0; i < datedWork.length; i++) {
  for (let j = i + 1; j < datedWork.length; j++) {
    const a = datedWork[i];

    const b = datedWork[j];

    const overlap = a.startSort <= b.endSort && b.startSort <= a.endSort;

    if (!overlap) {
      continue;
    }

    pushIssue(
      warnings,
      "work_date_overlap",
      `Work periods overlap: ${a.name} — ${a.position} (${a.startDate} to ${a.endDate ?? "present"}) and ${b.name} — ${b.position} (${b.startDate} to ${b.endDate ?? "present"}).`
    );
  }
}

/*
 * ----------------------------------------
 * 11. Summary checks
 * ----------------------------------------
 */

const summaryWordCount = summary.trim().split(/\s+/).filter(Boolean).length;

if (summaryWordCount < 25) {
  pushIssue(
    warnings,
    "summary_short",
    `Summary contains only ${summaryWordCount} words.`
  );
}

if (summaryWordCount > 90) {
  pushIssue(
    warnings,
    "summary_long",
    `Summary contains ${summaryWordCount} words.`
  );
}

const riskySummaryClaims = [
  {
    phrase: "expert in",

    reason: "Unverified expertise-level language.",
  },

  {
    phrase: "deep expertise",

    reason: "Unverified expertise-level language.",
  },

  {
    phrase: "maintaining high availability",

    reason:
      "Availability is currently supported as an engineering concern, not a verified achieved level.",
  },

  {
    phrase: "maintained high availability",

    reason:
      "Availability is currently supported as an engineering concern, not a verified achieved level.",
  },

  {
    phrase: "ensuring reliability",

    reason: "Broad reliability guarantee is not supported.",
  },

  {
    phrase: "ensure reliability",

    reason: "Broad reliability guarantee is not supported.",
  },
];

for (const item of riskySummaryClaims) {
  if (phraseExists(item.phrase, summary)) {
    pushIssue(
      warnings,
      "risky_summary_claim",
      `Summary contains risky wording: "${item.phrase}".`,
      {
        reason: item.reason,
      }
    );
  }
}

/*
 * ----------------------------------------
 * 12. Bullet sanity
 * ----------------------------------------
 */

for (const work of resume.work ?? []) {
  for (const bullet of work.highlights ?? []) {
    const wordCount = bullet.trim().split(/\s+/).filter(Boolean).length;

    if (wordCount > 45) {
      pushIssue(
        info,
        "long_bullet",
        `${work.name} — ${work.position} contains a long bullet (${wordCount} words).`,
        {
          bullet,
        }
      );
    }

    if (
      /\b(responsible for|worked on various|various tasks|etc\.)\b/i.test(
        bullet
      )
    ) {
      pushIssue(
        info,
        "weak_bullet_language",
        `${work.name} — ${work.position} contains generic wording.`,
        {
          bullet,
        }
      );
    }
  }
}

/*
 * ----------------------------------------
 * 13. Contact completeness
 * ----------------------------------------
 */

if (!resume.basics?.email) {
  pushIssue(errors, "missing_email", "Email is missing.");
}

if (!resume.basics?.phone) {
  pushIssue(warnings, "missing_phone", "Phone number is missing.");
}

const linkedin = (resume.basics?.profiles ?? []).find(
  (profile) => normalize(profile.network) === "linkedin"
);

if (!linkedin) {
  pushIssue(warnings, "missing_linkedin", "LinkedIn profile is missing.");
} else if (!linkedin.url) {
  pushIssue(
    warnings,
    "linkedin_without_url",
    "LinkedIn profile exists but has no URL."
  );
}

/*
 * ----------------------------------------
 * 14. Coverage summary
 * ----------------------------------------
 */

function categoryCoverage(category) {
  const items = coverage.filter(
    (item) => normalize(item.category) === normalize(category)
  );

  if (items.length === 0) {
    return null;
  }

  const found = items.filter((item) => item.found).length;

  return {
    found,
    total: items.length,

    percent: Math.round((found / items.length) * 100),
  };
}

const requiredCoverage = categoryCoverage("required");

const preferredCoverage = categoryCoverage("preferred");

const competencyCoverage =
  categoryCoverage("competency") ?? categoryCoverage("competencies");

/*
 * ----------------------------------------
 * 15. Final status
 * ----------------------------------------
 */

const status =
  errors.length > 0 ? "fail" : warnings.length > 0 ? "review" : "pass";

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

  status,

  counts: {
    errors: errors.length,

    warnings: warnings.length,

    info: info.length,
  },

  coverage: {
    required: requiredCoverage,

    preferred: preferredCoverage,

    competencies: competencyCoverage,

    terms: coverage,
  },

  unsupportedTerms,

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

console.log("\nFINAL CHECK");

console.log("===========");

console.log(
  `Target: ${report.target.company ?? "unknown"} — ${report.target.title ?? "unknown"}`
);

console.log(`Status: ${status.toUpperCase()}`);

if (requiredCoverage) {
  console.log(
    `Required coverage: ${requiredCoverage.found}/${requiredCoverage.total} (${requiredCoverage.percent}%)`
  );
}

if (preferredCoverage) {
  console.log(
    `Preferred coverage: ${preferredCoverage.found}/${preferredCoverage.total} (${preferredCoverage.percent}%)`
  );
}

if (competencyCoverage) {
  console.log(
    `Competency coverage: ${competencyCoverage.found}/${competencyCoverage.total} (${competencyCoverage.percent}%)`
  );
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
