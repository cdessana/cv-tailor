import { validateAlternatives, evaluateAlternative } from "../lib/job-requirements/alternatives.mjs";
import fs from "node:fs/promises";
import path from "node:path";

const [
  resumePath,
  jobPath,
  aliasesPath = "data/aliases.json",
  evidencePath = "data/evidence.json",
  outputRoot = "output",
] = process.argv.slice(2);

if (!resumePath || !jobPath) {
  console.error(
    "Usage: node scripts/analyse.mjs <resume.json> <job.json> [aliases.json] [evidence.json] [output-dir]"
  );
  process.exit(1);
}

const resume = JSON.parse(await fs.readFile(resumePath, "utf8"));

const job = JSON.parse(await fs.readFile(jobPath, "utf8"));

const aliases = JSON.parse(await fs.readFile(aliasesPath, "utf8"));

let evidence = {
  version: 2,
  skills: {},
  experiences: [],
};

try {
  evidence = JSON.parse(await fs.readFile(evidencePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }

  console.warn(`Evidence file not found: ${evidencePath}`);
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseExists(phrase, text) {
  const needle = normalize(phrase);
  const haystack = normalize(text);

  if (!needle || !haystack) {
    return false;
  }

  return ` ${haystack} `.includes(` ${needle} `);
}

function aliasesFor(term) {
  return [term, ...(aliases[term] ?? [])];
}

function unique(values) {
  return [...new Set(values)];
}

/*
 * ----------------------------------------
 * Resume skills
 * ----------------------------------------
 */

const resumeSkills = [];

for (const group of resume.skills ?? []) {
  for (const keyword of group.keywords ?? []) {
    resumeSkills.push({
      keyword,
      group: group.name,
      level: group.level ?? null,
    });
  }
}

function findResumeSkill(term) {
  const candidates = aliasesFor(term);

  const exact = resumeSkills.find(
    (skill) => normalize(skill.keyword) === normalize(term)
  );

  if (exact) {
    return {
      type: "resume-skill",
      status: "exact",
      matchedAs: exact.keyword,
      skillGroup: exact.group,
      level: exact.level,
    };
  }

  for (const candidate of candidates) {
    const match = resumeSkills.find(
      (skill) => normalize(skill.keyword) === normalize(candidate)
    );

    if (match) {
      return {
        type: "resume-skill",
        status: "equivalent",
        matchedAs: match.keyword,
        skillGroup: match.group,
        level: match.level,
      };
    }
  }

  return null;
}

/*
 * ----------------------------------------
 * Current resume work evidence
 * ----------------------------------------
 */

const resumeWorkEvidence = [];

for (const work of resume.work ?? []) {
  for (const highlight of work.highlights ?? []) {
    resumeWorkEvidence.push({
      company: work.name,
      position: work.position,
      text: highlight,
    });
  }
}

function findResumeWorkEvidence(term) {
  const candidates = aliasesFor(term);
  const results = [];

  for (const work of resumeWorkEvidence) {
    const matchedAs = candidates.find((candidate) =>
      phraseExists(candidate, work.text)
    );

    if (!matchedAs) {
      continue;
    }

    results.push({
      type: "resume-work",
      company: work.company,
      position: work.position,
      matchedAs,
      text: work.text,
    });
  }

  return results;
}

/*
 * ----------------------------------------
 * Certificates
 * ----------------------------------------
 */

function findCertificateEvidence(term) {
  const candidates = aliasesFor(term);
  const results = [];

  for (const certificate of resume.certificates ?? []) {
    const certificateText = [certificate.name, certificate.issuer]
      .filter(Boolean)
      .join(" ");

    const matchedAs = candidates.find((candidate) =>
      phraseExists(candidate, certificateText)
    );

    if (!matchedAs) {
      continue;
    }

    results.push({
      type: "certificate",
      name: certificate.name,
      issuer: certificate.issuer ?? null,
      matchedAs,
    });
  }

  return results;
}

/*
 * ----------------------------------------
 * evidence.json skill index
 * ----------------------------------------
 */

function findEvidenceSkillIndex(term) {
  const candidates = aliasesFor(term);

  for (const [skillName, value] of Object.entries(evidence.skills ?? {})) {
    const matchedAs = candidates.find(
      (candidate) => normalize(candidate) === normalize(skillName)
    );

    if (!matchedAs) {
      continue;
    }

    return {
      type: "evidence-skill",
      skill: skillName,
      level: value.level ?? null,
      matchedAs,
    };
  }

  return null;
}

/*
 * ----------------------------------------
 * Atomic professional experiences
 * ----------------------------------------
 */

function findExperienceEvidence(term) {
  const candidates = aliasesFor(term);
  const results = [];

  for (const experience of evidence.experiences ?? []) {
    const matchedSkill = (experience.skills ?? []).find((skill) =>
      candidates.some((candidate) => normalize(candidate) === normalize(skill))
    );

    if (!matchedSkill) {
      continue;
    }

    results.push({
      type: "experience",
      id: experience.id,
      company: experience.company,
      position: experience.position,
      period: experience.period ?? null,
      experienceType: experience.type ?? null,
      matchedAs: matchedSkill,
      facts: experience.facts ?? [],
      skills: experience.skills ?? [],
    });
  }

  return results;
}

/*
 * ----------------------------------------
 * Job requirements
 * ----------------------------------------
 */

const requirements = [
  ...(job.requirements?.required ?? []).map((term) => ({
    term,
    category: "required",
  })),

  ...(job.requirements?.preferred ?? []).map((term) => ({
    term,
    category: "preferred",
  })),

  ...(job.requirements?.competencies ?? []).map((term) => ({
    term,
    category: "competency",
  })),
];

/*
 * ----------------------------------------
 * Classification
 * ----------------------------------------
 */

function analyzeRequirement(requirement) {
  const { term, category } = requirement;

  const resumeSkill = findResumeSkill(term);

  const resumeWork = findResumeWorkEvidence(term);

  const certificateEvidence = findCertificateEvidence(term);

  const evidenceSkill = findEvidenceSkillIndex(term);

  const experiences = findExperienceEvidence(term);

  const allEvidence = [
    ...(resumeSkill ? [resumeSkill] : []),

    ...resumeWork,

    ...certificateEvidence,

    ...(evidenceSkill ? [evidenceSkill] : []),

    ...experiences,
  ];

  /*
   * Explicit familiarity is weaker than
   * professional evidence.
   */
  if (
    resumeSkill?.level &&
    normalize(resumeSkill.level) === "familiar" &&
    experiences.length === 0
  ) {
    return {
      term,
      category,
      status: "related",
      confidence: "familiar",
      evidenceTypes: unique(allEvidence.map((item) => item.type)),
      evidence: allEvidence,
    };
  }

  /*
   * Atomic professional evidence is strongest.
   */
  if (experiences.length > 0) {
    const canonicalMatch = experiences.some(
      (item) => normalize(item.matchedAs) === normalize(term)
    );

    return {
      term,
      category,

      status: canonicalMatch ? "exact" : "equivalent",

      confidence: "professional",

      evidenceTypes: unique(allEvidence.map((item) => item.type)),

      evidence: allEvidence,
    };
  }

  /*
   * Declared skill.
   */
  if (resumeSkill) {
    return {
      term,
      category,
      status: resumeSkill.status,
      confidence: "declared",

      evidenceTypes: unique(allEvidence.map((item) => item.type)),

      evidence: allEvidence,
    };
  }

  /*
   * Skill exists in evidence index but has
   * no contextual professional experience.
   */
  if (evidenceSkill) {
    return {
      term,
      category,
      status: "related",
      confidence: evidenceSkill.level ?? "declared",

      evidenceTypes: unique(allEvidence.map((item) => item.type)),

      evidence: allEvidence,
    };
  }

  /*
   * Certification proves exposure/training,
   * not professional hands-on experience.
   */
  if (certificateEvidence.length > 0) {
    return {
      term,
      category,
      status: "related",
      confidence: "certification",

      evidenceTypes: unique(allEvidence.map((item) => item.type)),

      evidence: allEvidence,
    };
  }

  /*
   * Work bullet evidence without a declared
   * skill still counts as related professional
   * evidence.
   */
  if (resumeWork.length > 0) {
    return {
      term,
      category,
      status: "related",
      confidence: "professional",

      evidenceTypes: ["resume-work"],

      evidence: resumeWork,
    };
  }

  return {
    term,
    category,
    status: "missing",
    confidence: "none",
    evidenceTypes: [],
    evidence: [],
  };
}

const results = [
  ...requirements.map(analyzeRequirement),
  ...validateAlternatives(job.alternativeRequirements).map((group) =>
    evaluateAlternative(group, (term) => analyzeRequirement({ term, category: group.classification }))),
];

/*
 * ----------------------------------------
 * Scores
 * ----------------------------------------
 */

const statusScore = {
  exact: 1,
  equivalent: 1,
  related: 0.5,
  missing: 0,
};

function scoreCategory(category) {
  const items = results.filter((item) => item.category === category);

  if (items.length === 0) {
    return 0;
  }

  const total = items.reduce(
    (sum, item) => sum + (statusScore[item.status] ?? 0),
    0
  );

  return Math.round((total / items.length) * 100);
}

const scores = {
  coreRequirements: scoreCategory("required"),

  preferred: scoreCategory("preferred"),

  engineeringCompetencies: scoreCategory("competency"),
};

const strong = results.filter(
  (item) => item.status === "exact" || item.status === "equivalent"
);

const related = results.filter((item) => item.status === "related");

const missing = results.filter((item) => item.status === "missing");

/*
 * ----------------------------------------
 * Tailoring recommendations
 * ----------------------------------------
 */

function summarizeEvidence(item) {
  return item.evidence
    .filter((entry) => entry.type !== "resume-skill")
    .map((entry) => ({
      type: entry.type,

      id: entry.id ?? null,

      company: entry.company ?? null,

      position: entry.position ?? null,

      period: entry.period ?? null,

      matchedAs: entry.matchedAs ?? null,

      text: entry.text ?? null,

      facts: entry.facts ?? [],

      certificate:
        entry.type === "certificate"
          ? {
              name: entry.name,
              issuer: entry.issuer,
            }
          : null,
    }));
}

const recommendedEmphasis = [...strong, ...related].map((item) => ({
  term: item.term,
  ...(item.alternative ? { alternative: item.alternative } : {}),

  category: item.category,

  status: item.status,

  confidence: item.confidence,

  evidenceTypes: item.evidenceTypes,

  evidence: summarizeEvidence(item),
}));

const doNotAdd = missing.map((item) => ({
  term: item.term,
  ...(item.alternative ? { alternative: item.alternative } : {}),

  category: item.category,

  reason:
    "No supporting evidence found in resume, certificates, or evidence database",
}));

/*
 * ----------------------------------------
 * Output
 * ----------------------------------------
 */

function slug(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const analysis = {
  job: {
    title: job.title,

    company: job.company,

    source: job.source ?? null,
  },

  sources: {
    resume: resumePath,

    job: jobPath,

    aliases: aliasesPath,

    evidence: evidencePath,
  },

  scores,

  matches: {
    strong,
    related,
    missing,
  },

  tailoring: {
    recommendedEmphasis,
    doNotAdd,
  },
};

await fs.mkdir(outputRoot, {
  recursive: true,
});

const outputPath = path.join(
  outputRoot,
  `${slug(job.company)}-${slug(job.title)}-analysis.json`
);

await fs.writeFile(outputPath, JSON.stringify(analysis, null, 2), "utf8");

/*
 * ----------------------------------------
 * Console report
 * ----------------------------------------
 */

function symbol(status) {
  if (status === "exact" || status === "equivalent") {
    return "✓";
  }

  if (status === "related") {
    return "~";
  }

  return "✗";
}

function printCategory(title, category, score) {
  console.log(`\n${title} ${score}%`);

  console.log("-".repeat(title.length + String(score).length + 2));

  for (const item of results.filter((entry) => entry.category === category)) {
    console.log(
      `${symbol(item.status)} ${item.term} — ${item.status.toUpperCase()} [${item.confidence}]`
    );

    const contextual = item.evidence.filter(
      (entry) => entry.type === "experience" || entry.type === "certificate"
    );

    for (const entry of contextual) {
      if (entry.type === "certificate") {
        console.log(
          `    ↳ certificate: ${entry.name}${
            entry.issuer ? ` · ${entry.issuer}` : ""
          }`
        );

        continue;
      }

      const context = [entry.company, entry.position, entry.period]
        .filter(Boolean)
        .join(" · ");

      console.log(`    ↳ ${entry.id}: ${context}`);
    }
  }
}

console.log(`\nAnalysis: ${job.company} — ${job.title}`);

printCategory("CORE REQUIREMENTS", "required", scores.coreRequirements);

printCategory("PREFERRED", "preferred", scores.preferred);

printCategory(
  "ENGINEERING COMPETENCIES",
  "competency",
  scores.engineeringCompetencies
);

console.log("\nDO NOT ADD");

console.log("----------");

for (const item of doNotAdd) {
  console.log(`✗ ${item.term}`);
}

console.log(`\nAnalysis written to ${outputPath}`);
