const headingGroups = {
  required: [
    "Requirements",
    "Required Qualifications",
    "Must Have",
    "Must haves",
    "What You'll Need",
    "Minimum Requirements",
    "Minimum Qualifications",
    "Basic Qualifications",
    "Requisitos",
    "Requisitos Obrigatórios",
    "Qualificações Obrigatórias",
    "O Que Esperamos de Você",
    "Conhecimentos Necessários",
  ],
  preferred: [
    "Preferred Qualifications",
    "Nice to Have",
    "Nice to haves",
    "Bonus",
    "Desirable",
    "Será um Diferencial",
    "Será um Diferencial se Você Tiver",
    "Diferenciais",
    "Desejável",
    "Conhecimentos Desejáveis",
    "Requisitos Desejáveis",
  ],
  responsibilities: [
    "Responsibilities",
    "What You'll Do",
    "What you will do",
    "Your Role",
    "What We're Looking For",
    "What We’re Looking For",
    "Responsabilidades",
    "Atividades",
    "Principais Atividades",
    "Como Será Seu Dia a Dia",
    "O Que Você Fará",
  ],
  competencies: ["Perfil Que Buscamos", "Competências", "Habilidades Comportamentais"],
};

const headingSignals = new Map(
  Object.entries(headingGroups).flatMap(([signal, headings]) =>
    headings.map((heading) => [heading.toLowerCase(), signal])
  )
);

function detectHeading(line) {
  if (line.blank || line.bullet) return null;
  const markdown = line.text.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/u);
  const candidate = markdown ? markdown[1] : line.text;
  const text = candidate.replace(/[:?!-]\s*$/u, "").trim();
  if (!text) return null;
  const key = text.replace(/[‘’]/gu, "'").toLowerCase();
  const signal = headingSignals.get(key) ?? null;
  // Unknown plain-text labels require an explicit colon and a short label.
  // Longer/unmarked prose remains content rather than a guessed heading.
  const label =
    candidate.endsWith(":") &&
    text.split(" ").length <= 6 &&
    !/[.!?:]/u.test(text);
  return signal || markdown || label ? { text, signal } : null;
}

/** Internal line-record consumer; call preprocessJobDescription for raw text. */
export function buildSections(lines, originalText) {
  const sections = [];
  let section = null;
  let unit = null;

  function finishUnit() {
    if (!unit) return;
    section.units.push({
      id: `unit-${unit.start}-${unit.end}`,
      type: unit.type,
      text: unit.parts.join(" "),
      originalText: originalText.slice(unit.start, unit.end),
      start: unit.start,
      end: unit.end,
      indentation: unit.indentation,
    });
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
      section = { heading: null, signal: null, units: [] };
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
