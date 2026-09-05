import fs from "node:fs/promises";

const [resumePath, jobPath, aliasesPath = "data/aliases.json"] =
  process.argv.slice(2);

if (!resumePath || !jobPath) {
  console.error(
    "Usage: node scripts/match.mjs <resume.json> <job.json> [aliases.json]"
  );
  process.exit(1);
}

const resume = JSON.parse(await fs.readFile(resumePath, "utf8"));

const job = JSON.parse(await fs.readFile(jobPath, "utf8"));

const aliases = JSON.parse(await fs.readFile(aliasesPath, "utf8"));

function normalize(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
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

function collectResumeData(resume) {
  const skills = [];
  const evidence = [];

  for (const skillGroup of resume.skills ?? []) {
    const level = skillGroup.level ?? null;

    for (const keyword of skillGroup.keywords ?? []) {
      skills.push({
        term: keyword,
        group: skillGroup.name ?? null,
        level,
      });
    }
  }

  for (const work of resume.work ?? []) {
    for (const highlight of work.highlights ?? []) {
      evidence.push({
        type: "work",
        company: work.name,
        position: work.position,
        text: highlight,
      });
    }
  }

  return {
    skills,
    evidence,
  };
}

const resumeData = collectResumeData(resume);

function aliasesFor(term) {
  return aliases[term] ?? [term];
}

function findExactSkill(term) {
  const normalizedTerm = normalize(term);

  return resumeData.skills.find(
    (skill) => normalize(skill.term) === normalizedTerm
  );
}

function findEquivalentSkill(term) {
  const normalizedTerm = normalize(term);

  for (const alias of aliasesFor(term)) {
    const normalizedAlias = normalize(alias);

    if (normalizedAlias === normalizedTerm) {
      continue;
    }

    const match = resumeData.skills.find(
      (skill) => normalize(skill.term) === normalizedAlias
    );

    if (match) {
      return {
        alias,
        match,
      };
    }
  }

  return null;
}

function findEvidence(term) {
  for (const candidate of aliasesFor(term)) {
    for (const item of resumeData.evidence) {
      if (phraseExists(candidate, item.text)) {
        return {
          candidate,
          evidence: item,
        };
      }
    }
  }

  return null;
}

function classify(term) {
  const exact = findExactSkill(term);

  if (exact) {
    if (String(exact.level ?? "").toLowerCase() === "familiar") {
      return {
        status: "related",
        reason: `listed as familiar: ${exact.term}`,
        evidence: null,
      };
    }

    return {
      status: "exact",
      reason: `explicit skill: ${exact.term}`,
      evidence: null,
    };
  }

  const equivalent = findEquivalentSkill(term);

  if (equivalent) {
    return {
      status: "equivalent",
      reason: `equivalent to: ${equivalent.match.term}`,
      evidence: null,
    };
  }

  const evidence = findEvidence(term);

  if (evidence) {
    return {
      status: "related",
      reason: `related evidence: ${evidence.candidate}`,
      evidence: evidence.evidence,
    };
  }

  return {
    status: "missing",
    reason: null,
    evidence: null,
  };
}

function analyze(items) {
  return items.map((term) => ({
    term,
    ...classify(term),
  }));
}

function icon(status) {
  switch (status) {
    case "exact":
      return "✓";
    case "equivalent":
      return "✓";
    case "related":
      return "~";
    default:
      return "✗";
  }
}

function label(status) {
  switch (status) {
    case "exact":
      return "EXACT";
    case "equivalent":
      return "EQUIVALENT";
    case "related":
      return "RELATED";
    default:
      return "MISSING";
  }
}

function score(results) {
  const points = results.reduce((total, item) => {
    switch (item.status) {
      case "exact":
      case "equivalent":
        return total + 1;

      case "related":
        return total + 0.5;

      default:
        return total;
    }
  }, 0);

  return Math.round((points / Math.max(results.length, 1)) * 100);
}

function printSection(title, results) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));

  for (const item of results) {
    console.log(`${icon(item.status)} ${item.term} [${label(item.status)}]`);

    if (item.reason) {
      console.log(`  ${item.reason}`);
    }

    if (item.evidence) {
      console.log(
        `  evidence: ${item.evidence.company} — ${item.evidence.position}`
      );

      console.log(`  "${item.evidence.text}"`);
    }
  }

  console.log(`\nScore: ${score(results)}%`);
}

const requirements = job.requirements ?? {};

const required = analyze(requirements.required ?? []);

const preferred = analyze(requirements.preferred ?? []);

const competencies = analyze(requirements.competencies ?? []);

console.log(`\n${job.company} — ${job.title}`);

printSection("CORE REQUIREMENTS", required);

printSection("PREFERRED", preferred);

printSection("ENGINEERING COMPETENCIES", competencies);

console.log("\nSUMMARY");
console.log("-------");

console.log(`Core requirements:        ${score(required)}%`);

console.log(`Preferred:                ${score(preferred)}%`);

console.log(`Engineering competencies: ${score(competencies)}%`);
