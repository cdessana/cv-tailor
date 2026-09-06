import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load-config.mjs";

const config = loadConfig();

const [
  resumePath,
  analysisPath,
  aliasesPath = config.paths.aliases,
  evidencePath = config.paths.evidence,
] = process.argv.slice(2);

if (!resumePath || !analysisPath) {
  console.error(
    "Usage: node scripts/tailor.mjs <resume.json> <analysis.json> [aliases.json] [evidence.json]"
  );
  process.exit(1);
}

const resume = JSON.parse(await fs.readFile(resumePath, "utf8"));

const analysis = JSON.parse(await fs.readFile(analysisPath, "utf8"));

const aliases = JSON.parse(await fs.readFile(aliasesPath, "utf8"));

const evidence = JSON.parse(await fs.readFile(evidencePath, "utf8"));

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

const categoryWeight = {
  required: 5,
  preferred: 3,
  competency: 2,
};

const statusWeight = {
  exact: 1,
  equivalent: 1,
  related: 0.5,
  missing: 0,
};

const supportedTerms = [
  ...(analysis.matches?.strong ?? []),
  ...(analysis.matches?.related ?? []),
].map((item) => ({
  term: item.term,
  category: item.category,
  status: item.status,
  confidence: item.confidence ?? null,
}));

function requirementPoints(requirement) {
  return (
    (categoryWeight[requirement.category] ?? 1) *
    (statusWeight[requirement.status] ?? 0)
  );
}

/*
 * ----------------------------------------
 * Requirement matching
 * ----------------------------------------
 */

function matchRequirementAgainstText(requirement, text) {
  const matchedAs = aliasesFor(requirement.term).find((candidate) =>
    phraseExists(candidate, text)
  );

  if (!matchedAs) {
    return null;
  }

  return {
    term: requirement.term,
    matchedAs,
    category: requirement.category,
    status: requirement.status,
    points: requirementPoints(requirement),
  };
}

function matchRequirementAgainstSkills(requirement, skills) {
  const candidates = aliasesFor(requirement.term);

  const matchedAs = (skills ?? []).find((skill) =>
    candidates.some((candidate) => normalize(candidate) === normalize(skill))
  );

  if (!matchedAs) {
    return null;
  }

  return {
    term: requirement.term,
    matchedAs,
    category: requirement.category,
    status: requirement.status,
    points: requirementPoints(requirement),
  };
}

/*
 * ----------------------------------------
 * Generic signals
 * ----------------------------------------
 */

function engineeringScore(text) {
  const signals = [
    ["architecture", 1],
    ["scalab", 1],
    ["performance", 1],
    ["availability", 1],
    ["mentor", 1],
    ["lead", 1],
    ["distributed", 1],
    ["event-driven", 1],
    ["continuous integration", 1],
    ["gitlab ci", 1],
    ["test", 0.5],
  ];

  const normalized = normalize(text);

  return signals.reduce(
    (sum, [phrase, points]) =>
      normalized.includes(normalize(phrase)) ? sum + points : sum,
    0
  );
}

function impactScore(text) {
  let score = 0;

  if (/\d+%/.test(text)) {
    score += 2;
  }

  if (/\d+\+/.test(text)) {
    score += 1;
  }

  if (
    /\b\d+\s+(engineers|interns|projects|services|interfaces|devices|people)\b/i.test(
      text
    )
  ) {
    score += 1;
  }

  return score;
}

/*
 * ----------------------------------------
 * Candidate creation
 * ----------------------------------------
 */

function createResumeCandidate(work, highlight, index) {
  const matches = supportedTerms
    .map((requirement) => matchRequirementAgainstText(requirement, highlight))
    .filter(Boolean);

  const jobScore = matches.reduce((sum, match) => sum + match.points, 0);

  const engineering = engineeringScore(highlight);

  const impact = impactScore(highlight);

  return {
    id: `resume:${normalize(work.name)}:${normalize(work.position)}:${index}`,

    type: "resume-bullet",

    company: work.name,

    position: work.position,

    originalIndex: index,

    evidenceId: null,

    text: highlight,

    facts: [],

    skills: [],

    baseScore: jobScore + engineering + impact,

    scoreBreakdown: {
      job: jobScore,

      engineering,

      impact,
    },

    matches,
  };
}

function createEvidenceCandidate(experience) {
  const matches = supportedTerms
    .map((requirement) =>
      matchRequirementAgainstSkills(requirement, experience.skills ?? [])
    )
    .filter(Boolean);

  const jobScore = matches.reduce((sum, match) => sum + match.points, 0);

  const factText = (experience.facts ?? []).join(" ");

  const engineering = engineeringScore(factText);

  const impact = impactScore(factText);

  const evidenceBonus = matches.length > 0 ? 1 : 0;

  return {
    id: `evidence:${experience.id}`,

    type: "evidence",

    evidenceId: experience.id,

    company: experience.company,

    position: experience.position,

    period: experience.period ?? null,

    text: null,

    facts: experience.facts ?? [],

    skills: experience.skills ?? [],

    baseScore: jobScore + engineering + impact + evidenceBonus,

    scoreBreakdown: {
      job: jobScore,

      engineering,

      impact,

      evidenceBonus,
    },

    matches,
  };
}

function candidatesForRole(work) {
  const resumeCandidates = (work.highlights ?? []).map((highlight, index) =>
    createResumeCandidate(work, highlight, index)
  );

  const evidenceCandidates = (evidence.experiences ?? [])
    .filter(
      (item) =>
        normalize(item.company) === normalize(work.name) &&
        normalize(item.position) === normalize(work.position)
    )
    .map(createEvidenceCandidate);

  return [...resumeCandidates, ...evidenceCandidates];
}

function roleLimit(index) {
  if (index === 0) {
    return config.pipeline.maxBulletsPerRole;
  }

  if (index === 1) {
    // Taper down by 1 for the second role, ensuring it doesn't drop below 1
    return Math.max(config.pipeline.maxBulletsPerRole - 1, 1);
  }

  // Keep older roles strictly limited to 2 bullets to prevent resume bloat
  return Math.min(2, config.pipeline.maxBulletsPerRole);
}

/*
 * ----------------------------------------
 * Global coverage
 * ----------------------------------------
 */

function coveredTerms(selected) {
  return new Set(
    selected.flatMap((candidate) =>
      candidate.matches.map((match) => match.term)
    )
  );
}

function overlapCount(candidate, globallySelected) {
  const alreadyCovered = coveredTerms(globallySelected);

  return candidate.matches.filter((match) => alreadyCovered.has(match.term))
    .length;
}

function newCoverageScore(candidate, globallySelected) {
  const alreadyCovered = coveredTerms(globallySelected);

  return candidate.matches.reduce((sum, match) => {
    if (alreadyCovered.has(match.term)) {
      return sum;
    }

    return sum + match.points;
  }, 0);
}

function redundancyPenalty(candidate, globallySelected) {
  const overlap = overlapCount(candidate, globallySelected);

  return overlap * 1.5;
}

function candidateSelectionScore(candidate, globallySelected) {
  const newCoverage = newCoverageScore(candidate, globallySelected);

  const redundancy = redundancyPenalty(candidate, globallySelected);

  return candidate.baseScore + newCoverage - redundancy;
}

/*
 * ----------------------------------------
 * Coverage metadata
 * ----------------------------------------
 */

function concreteRequiredTerm(candidate, match) {
  /*
   * Generic RPC requirement is backed by
   * concrete gRPC professional evidence.
   */
  if (
    normalize(match.term) === normalize("RPC") &&
    (candidate.skills ?? []).some(
      (skill) => normalize(skill) === normalize("gRPC")
    )
  ) {
    return "gRPC";
  }

  /*
   * Evidence candidates should preserve
   * the concrete skill actually used.
   */
  if (candidate.type === "evidence") {
    const concreteSkill = (candidate.skills ?? []).find((skill) =>
      aliasesFor(match.term).some(
        (alias) => normalize(alias) === normalize(skill)
      )
    );

    if (concreteSkill) {
      return concreteSkill;
    }
  }

  return match.matchedAs ?? match.term;
}

function deriveCoverageMetadata(candidate, previouslySelected) {
  const alreadyCovered = coveredTerms(previouslySelected);

  /*
   * Why did this candidate add something
   * new at the moment it was selected?
   */
  const coverageReason = candidate.matches
    .filter((match) => !alreadyCovered.has(match.term))
    .map((match) => match.term);

  /*
   * Only REQUIRED job requirements that
   * provide NEW coverage become mandatory
   * wording for the eventual generated bullet.
   *
   * Preferred requirements and competencies
   * are useful for ranking but are not forced
   * into every bullet.
   */
  const requiredTerms = unique(
    candidate.matches
      .filter(
        (match) =>
          match.category === "required" && coverageReason.includes(match.term)
      )
      .map((match) => concreteRequiredTerm(candidate, match))
  );

  /*
   * All remaining matches are optional.
   *
   * This includes:
   * - already covered required requirements;
   * - preferred requirements;
   * - engineering competencies.
   */
  const optionalTerms = unique(
    candidate.matches
      .filter(
        (match) =>
          !(
            match.category === "required" && coverageReason.includes(match.term)
          )
      )
      .map((match) => concreteRequiredTerm(candidate, match))
  );

  return {
    coverageReason: unique(coverageReason),

    requiredTerms,

    optionalTerms,
  };
}

/*
 * ----------------------------------------
 * Role selection using global state
 * ----------------------------------------
 */

function selectRoleCandidates(work, roleIndex, globallySelected) {
  const candidates = candidatesForRole(work);

  const limit = roleLimit(roleIndex);

  if (candidates.length === 0) {
    return {
      selected: [],
      omitted: [],
    };
  }

  const selected = [];

  while (selected.length < limit) {
    const available = candidates.filter(
      (candidate) => !selected.some((item) => item.id === candidate.id)
    );

    if (available.length === 0) {
      break;
    }

    const combinedSelected = [...globallySelected, ...selected];

    const ranked = available
      .map((candidate) => ({
        ...candidate,

        selectionScore: candidateSelectionScore(candidate, combinedSelected),

        newCoverageScore: newCoverageScore(candidate, combinedSelected),

        redundancyPenalty: redundancyPenalty(candidate, combinedSelected),
      }))
      .sort((a, b) => {
        if (b.selectionScore !== a.selectionScore) {
          return b.selectionScore - a.selectionScore;
        }

        return b.baseScore - a.baseScore;
      });

    const best = ranked[0];

    if (!best || best.selectionScore <= 0) {
      break;
    }

    /*
     * Capture WHY this candidate is selected
     * BEFORE adding it to global coverage.
     */
    const coverageMetadata = deriveCoverageMetadata(best, combinedSelected);

    selected.push({
      ...best,
      ...coverageMetadata,
    });
  }

  const selectedIds = new Set(selected.map((item) => item.id));

  const finalContext = [...globallySelected, ...selected];

  const omitted = candidates
    .filter((candidate) => !selectedIds.has(candidate.id))
    .map((candidate) => ({
      ...candidate,

      selectionScore: candidateSelectionScore(candidate, finalContext),

      newCoverageScore: newCoverageScore(candidate, finalContext),

      redundancyPenalty: redundancyPenalty(candidate, finalContext),
    }))
    .sort((a, b) => b.selectionScore - a.selectionScore);

  return {
    selected,
    omitted,
  };
}

/*
 * ----------------------------------------
 * Build global plan
 * ----------------------------------------
 */

const rolePlans = [];

const globallySelected = [];

for (let index = 0; index < resume.work.length; index++) {
  const work = resume.work[index];

  const selection = selectRoleCandidates(work, index, globallySelected);

  rolePlans.push({
    company: work.name,

    position: work.position,

    selected: selection.selected,

    omitted: selection.omitted,
  });

  globallySelected.push(...selection.selected);
}

/*
 * ----------------------------------------
 * Safe deterministic resume
 * ----------------------------------------
 *
 * Evidence candidates still do NOT become
 * bullets here.
 *
 * resume.json therefore contains only text
 * that already existed in base.json.
 */

const safeWork = resume.work.map((work) => {
  const plan = rolePlans.find(
    (item) => item.company === work.name && item.position === work.position
  );

  const selectedResumeBullets = (plan?.selected ?? [])
    .filter((candidate) => candidate.type === "resume-bullet")
    .sort((a, b) => a.originalIndex - b.originalIndex);

  const tailored = {
    ...work,

    highlights: selectedResumeBullets.map((candidate) => candidate.text),
  };

  if (tailored.endDate === "") {
    delete tailored.endDate;
  }

  return tailored;
});

/*
 * ----------------------------------------
 * Skills ordering
 * ----------------------------------------
 */

function scoreSkill(keyword) {
  let score = 0;

  for (const requirement of supportedTerms) {
    const matched = aliasesFor(requirement.term).some(
      (candidate) => normalize(candidate) === normalize(keyword)
    );

    if (!matched) {
      continue;
    }

    score += categoryWeight[requirement.category] ?? 1;
  }

  return score;
}

const tailoredSkills = (resume.skills ?? [])
  .map((group) => {
    const ranked = (group.keywords ?? [])
      .map((keyword) => ({
        keyword,

        score: scoreSkill(keyword),
      }))
      .sort((a, b) => b.score - a.score);

    return {
      ...group,

      keywords: ranked.map((item) => item.keyword),

      _relevance: ranked.reduce((sum, item) => sum + item.score, 0),
    };
  })
  .sort((a, b) => b._relevance - a._relevance)
  .map(({ _relevance, ...group }) => group);

const tailoredResume = {
  ...resume,

  work: safeWork,

  skills: tailoredSkills,
};

/*
 * ----------------------------------------
 * Global coverage report
 * ----------------------------------------
 */

const finalCovered = coveredTerms(globallySelected);

const globalCoverage = supportedTerms.map((requirement) => ({
  term: requirement.term,

  category: requirement.category,

  status: requirement.status,

  covered: finalCovered.has(requirement.term),

  selectedBy: globallySelected
    .filter((candidate) =>
      candidate.matches.some((match) => match.term === requirement.term)
    )
    .map((candidate) => ({
      id: candidate.id,

      type: candidate.type,

      company: candidate.company,

      position: candidate.position,
    })),
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

const company = analysis.job?.company ?? "company";

const title = analysis.job?.title ?? "role";

const outputDirectory = path.join("output", slug(company));

await fs.mkdir(outputDirectory, {
  recursive: true,
});

const resumeOutput = path.join(outputDirectory, "resume.json");

const planOutput = path.join(outputDirectory, "tailoring-plan.json");

const reportOutput = path.join(outputDirectory, "tailoring-report.json");

await fs.writeFile(
  resumeOutput,
  JSON.stringify(tailoredResume, null, 2),
  "utf8"
);

await fs.writeFile(
  planOutput,
  JSON.stringify(
    {
      job: analysis.job,

      scores: analysis.scores,

      generatedAt: new Date().toISOString(),

      globalCoverage,

      roles: rolePlans.map((role) => ({
        company: role.company,

        position: role.position,

        selected: role.selected.map((candidate) => ({
          id: candidate.id,

          type: candidate.type,

          evidenceId: candidate.evidenceId,

          text: candidate.text,

          facts: candidate.facts,

          skills: candidate.skills,

          period: candidate.period ?? null,

          coverageReason: candidate.coverageReason ?? [],

          requiredTerms: candidate.requiredTerms ?? [],

          optionalTerms: candidate.optionalTerms ?? [],

          baseScore: candidate.baseScore,

          selectionScore: candidate.selectionScore,

          newCoverageScore: candidate.newCoverageScore,

          redundancyPenalty: candidate.redundancyPenalty,

          matches: candidate.matches,
        })),
      })),

      safety: {
        unsupportedTerms: analysis.tailoring?.doNotAdd ?? [],
      },
    },
    null,
    2
  ),
  "utf8"
);

await fs.writeFile(
  reportOutput,
  JSON.stringify(
    {
      job: analysis.job,

      scores: analysis.scores,

      generatedAt: new Date().toISOString(),

      globalCoverage,

      roles: rolePlans,

      safety: {
        unsupportedTerms: analysis.tailoring?.doNotAdd ?? [],
      },
    },
    null,
    2
  ),
  "utf8"
);

/*
 * ----------------------------------------
 * Console report
 * ----------------------------------------
 */

console.log(`\nTailoring plan for ${company} — ${title}`);

console.log("\nSELECTED CANDIDATES");

console.log("-------------------");

for (const role of rolePlans) {
  console.log(`\n${role.company}`);

  console.log(role.position);

  for (const candidate of role.selected) {
    console.log(
      `\n[base ${candidate.baseScore.toFixed(2)} | final ${candidate.selectionScore.toFixed(2)}] ${candidate.type}`
    );

    if (candidate.type === "resume-bullet") {
      console.log(`  ${candidate.text}`);
    } else {
      console.log(`  evidence: ${candidate.evidenceId}`);

      console.log(`  skills: ${candidate.skills.join(", ")}`);
    }

    if (candidate.matches.length > 0) {
      console.log(
        `  matches: ${candidate.matches.map((match) => match.term).join(", ")}`
      );
    }

    if (candidate.coverageReason?.length > 0) {
      console.log(`  coverage reason: ${candidate.coverageReason.join(", ")}`);
    }

    if (candidate.requiredTerms?.length > 0) {
      console.log(`  required terms: ${candidate.requiredTerms.join(", ")}`);
    }

    if (candidate.optionalTerms?.length > 0) {
      console.log(`  optional terms: ${candidate.optionalTerms.join(", ")}`);
    }

    if (candidate.newCoverageScore > 0) {
      console.log(`  new coverage: +${candidate.newCoverageScore.toFixed(2)}`);
    }

    if (candidate.redundancyPenalty > 0) {
      console.log(`  redundancy: -${candidate.redundancyPenalty.toFixed(2)}`);
    }
  }
}

console.log("\nGLOBAL COVERAGE");

console.log("---------------");

for (const item of globalCoverage) {
  console.log(`${item.covered ? "✓" : "○"} ${item.term}`);
}

console.log("\nDO NOT ADD");

console.log("----------");

for (const item of analysis.tailoring?.doNotAdd ?? []) {
  console.log(`✗ ${item.term}`);
}

console.log(`\nSafe resume: ${resumeOutput}`);

console.log(`Tailoring plan: ${planOutput}`);

console.log(`Full report: ${reportOutput}`);
