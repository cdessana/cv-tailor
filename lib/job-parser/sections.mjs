const headingGroups = {
  required: [
    "Requirements",
    "Requirements Description",
    "Years Of Experience",
    "Required Skills/experience",
    "Must-have",
    "Working with",
    "Foreign language",
    "Required Qualifications",
    "Must Have",
    "Must haves",
    "What You'll Need",
    "What You Will Need",
    "What You'll Bring",
    "What You Will Bring",
    "What We're Looking For",
    "What We Are Looking For",
    "What You Need",
    "Who You Are",
    "Minimum Requirements",
    "Minimum Qualifications",
    "Basic Qualifications",
    "Requisitos e habilidades que buscamos",
    "Requisitos",
    "Requisitos Obrigatórios",
    "Qualificações Obrigatórias",
    "O Que Esperamos de Você",
    "Conhecimentos Necessários",
    "O Que Procuramos",
    "O que estamos procurando na pessoa que vai fazer parte do time",
  ],
  preferred: [
    "Preferred Qualifications",
    "Preferred",
    "Nice to Have",
    "Desired",
    "Nice to haves",
    "Bonus",
    "It's a Bonus if You Have",
    "It is a Bonus if You Have",
    "Bonus if You Have",
    "Desirable",
    "Será um Diferencial",
    "Além disso, é desejável conhecimento",
    "Será um Diferencial se Você Tiver",
    "Diferenciais",
    "Desejável",
    "Conhecimentos Desejáveis",
    "Requisitos Desejáveis",
  ],
  responsibilities: [
    "Responsibilities",
    "What You'll Do",
    "What You Will Do",
    "What You'll Own",
    "What You Will Own",
    "What you will do",
    "In this role, you will",
    "Your Role",
    "Your Responsibilities",
    "Key Responsibilities",
    "Responsabilidades",
    "Atividades",
    "Activities",
    "Principais Atividades",
    "Como Será Seu Dia a Dia",
    "O Que Você Fará",
    "O que você vai fazer no seu dia a dia",
    "Você assumirá as seguintes responsabilidades",
  ],
  competencies: [
    "Perfil Que Buscamos",
    "Competências",
    "Habilidades Comportamentais",
    "Soft Skills",
  ],
};

const headingDescriptors = new Map(
  Object.entries(headingGroups).flatMap(([signal, headings]) =>
    headings.map((heading) => [
      heading.replace(/[‘’]/gu, "'").toLowerCase(),
      { signal, role: "candidate-content" },
    ])
  )
);
const inferredHeadingDescriptors = new Map([
  ["job responsibilities", { signal: "responsibilities", role: "candidate-content" }],
  ["role responsibilities", { signal: "responsibilities", role: "candidate-content" }],
  ["key duties", { signal: "responsibilities", role: "candidate-content" }],
  ["qualifications", { signal: "required", role: "candidate-content" }],
  ["skills and qualifications", { signal: "required", role: "candidate-content" }],
  ["desired qualifications", { signal: "preferred", role: "candidate-content" }],
  ["benefits and perks", { signal: null, role: "context" }],
  ["compensation and benefits", { signal: null, role: "context" }],
  ["equal opportunity", { signal: null, role: "context" }],
  ["application process", { signal: null, role: "context" }],
]);

for (const heading of [
  "About The Team",
  "Sobre a oportunidade",
  "Sobre a Accenture",
  "O que oferecemos",
  "Localidade da vaga",
  "Benefícios",
  "About The Job",
  "About Zerohash",
  "Benefits",
  "The zerohash Culture",
  "Follow us",
  "See something suspicious",
  "Offer Description",
  "About Azion",
  "About The Position",
  "About the Company",
  "About Us",
  "Sobre o Bradesco",
  "Sobre a área",
  "Modelo de trabalho",
  "O que você encontra aqui",
  "Cuidar de você",
  "Crescer com você",
  "Segurança para o seu futuro",
  "Apoio à sua vida e à sua família",
  "Diversidade",
  "Who We Are",
  "What makes a Globalpayer",
  "Benefits & Azion Way Of Life",
  "Como tornamos seu trabalho (e sua vida) mais fácil",
  "Why join Clara",
  "What we believe in",
  "What we offer",
  "Clara's Hybrid Policy",
]) {
  headingDescriptors.set(heading.toLowerCase(), {
    signal: null,
    role: "context",
  });
}

function detectHeading(line) {
  if (line.blank || line.bullet) return null;
  const markdown = line.text.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/u);
  const candidate = markdown ? markdown[1] : line.text;
  const text = candidate.replace(/[:?!-]\s*$/u, "").trim();
  if (!text) return null;
  const key = text.replace(/[‘’]/gu, "'").toLowerCase();
  // Some sources use a full stop after a stand-alone heading (for example,
  // "Activities."). Treat it as presentation punctuation only when the
  // resulting label is otherwise known; ordinary prose remains untouched.
  const normalizedKey = key.replace(/\.\s*$/u, "");
  const descriptor =
    headingDescriptors.get(key) ??
    inferredHeadingDescriptors.get(key) ??
    headingDescriptors.get(normalizedKey) ??
    inferredHeadingDescriptors.get(normalizedKey) ??
    // Archived posts commonly use "About <Company>" without an explicit
    // separator. It introduces employer context, not candidate criteria.
    (/^About\s+(?:[A-Z0-9][A-Z0-9 .&'-]*)$/u.test(text)
      ? { signal: null, role: "context" }
      : null);
  // Unknown plain-text labels require an explicit colon and a short label.
  // Longer/unmarked prose remains content rather than a guessed heading.
  const label =
    candidate.endsWith(":") &&
    text.split(" ").length <= 6 &&
    !/[.!?:]/u.test(text);
  return descriptor || markdown || label
    ? {
        text,
        signal: descriptor?.signal ?? null,
        role: descriptor?.role ?? "unknown",
      }
    : null;
}

// Large scraped paragraphs cause the semantic provider to mix unrelated
// requirements. Split only at sentence boundaries outside parentheses, while
// retaining exact original offsets for evidence validation. Bullets stay whole.
function splitLongParagraph(unit, originalText, maximum = 650) {
  const source = originalText.slice(unit.start, unit.end);
  if (unit.type !== "paragraph" || source.length <= maximum) return [unit];
  const boundaries = [];
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") depth = Math.max(0, depth - 1);
    if (
      depth === 0 &&
      /[.!?]/u.test(source[index]) &&
      (index === source.length - 1 || /\s/u.test(source[index + 1] ?? ""))
    )
      boundaries.push(index + 1);
  }
  if (!boundaries.length) return [unit];
  const ranges = [];
  let start = 0;
  let candidate = null;
  for (const end of boundaries) {
    if (end - start <= maximum) {
      candidate = end;
      continue;
    }
    // Prefer the last complete sentence before the limit. If a single sentence
    // exceeds it, retain that sentence whole instead of splitting its meaning.
    const split = candidate ?? end;
    ranges.push([start, split]);
    start = split;
    candidate = end === split ? null : end;
  }
  if (source.length - start) ranges.push([start, source.length]);
  if (ranges.length === 1) return [unit];
  return ranges.map(([start, end]) => {
    const leading = source.slice(start, end).match(/^\s*/u)[0].length;
    const trailing = source.slice(start, end).match(/\s*$/u)[0].length;
    const absoluteStart = unit.start + start + leading;
    const absoluteEnd = unit.start + end - trailing;
    return {
      ...unit,
      start: absoluteStart,
      end: absoluteEnd,
      id: `unit-${absoluteStart}-${absoluteEnd}`,
      originalText: originalText.slice(absoluteStart, absoluteEnd),
      text: originalText
        .slice(absoluteStart, absoluteEnd)
        .replace(/\s+/gu, " ")
        .trim(),
    };
  });
}

/** Internal line-record consumer; call preprocessJobDescription for raw text. */
export function buildSections(lines, originalText) {
  const sections = [];
  let section = null;
  let unit = null;

  function finishUnit() {
    if (!unit) return;
    const completed = {
      id: `unit-${unit.start}-${unit.end}`,
      type: unit.type,
      text: unit.parts.join(" "),
      originalText: originalText.slice(unit.start, unit.end),
      start: unit.start,
      end: unit.end,
      indentation: unit.indentation,
    };
    section.units.push(...splitLongParagraph(completed, originalText));
    unit = null;
  }

  for (const line of lines) {
    const heading = detectHeading(line);
    if (heading) {
      finishUnit();
      section = {
        heading: {
          text: heading.text,
          originalText: originalText.slice(line.start, line.end),
          start: line.start,
          end: line.end,
        },
        signal: heading.signal,
        role: heading.role,
        units: [],
      };
      sections.push(section);
      continue;
    }
    if (line.blank) {
      finishUnit();
      continue;
    }
    if (!section) {
      section = { heading: null, signal: null, role: "unknown", units: [] };
      sections.push(section);
    }
    if (line.bullet) finishUnit();
    if (!unit) {
      unit = {
        type: line.bullet ? "bullet" : "paragraph",
        start: line.start,
        end: line.end,
        indentation: line.indentation,
        parts: [],
      };
    }
    unit.parts.push(line.text);
    unit.end = line.end;
  }
  finishUnit();
  return sections;
}
