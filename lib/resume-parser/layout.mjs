function decodeXml(value) {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}

function sourceFromLine(line, format, page = 1, lineNumber) {
  return {
    page,
    lineStart: lineNumber,
    lineEnd: lineNumber,
    text: line,
    format,
  };
}

export function documentFromText(text, { format = "txt" } = {}) {
  const lines = text
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00a0/gu, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ text: line, source: sourceFromLine(line, format, 1, index + 1) }));
  return { format, text: lines.map((line) => line.text).join("\n"), pages: 1, lines };
}

function wordsInPage(pageXml, page) {
  const words = [];
  const expression = /<word\s+xMin="([^"]+)"\s+yMin="([^"]+)"\s+xMax="([^"]+)"\s+yMax="([^"]+)"[^>]*>(.*?)<\/word>/gu;
  for (const match of pageXml.matchAll(expression)) {
    const text = decodeXml(match[5]).trim();
    if (text) words.push({ text, page, xMin: Number(match[1]), yMin: Number(match[2]), xMax: Number(match[3]), yMax: Number(match[4]) });
  }
  return words;
}

function splitRowIntoSegments(words) {
  const sorted = [...words].sort((left, right) => left.xMin - right.xMin);
  const segments = [];
  let segment = [];
  for (const word of sorted) {
    const previous = segment.at(-1);
    if (previous && word.xMin - previous.xMax > 42) {
      segments.push(segment);
      segment = [];
    }
    segment.push(word);
  }
  if (segment.length) segments.push(segment);
  return segments;
}

function pageLines(words, page) {
  const rows = [];
  for (const word of [...words].sort((left, right) => left.yMin - right.yMin || left.xMin - right.xMin)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - word.yMin) <= 2);
    if (row) row.words.push(word);
    else rows.push({ y: word.yMin, words: [word] });
  }
  const segments = rows.flatMap((row) => splitRowIntoSegments(row.words).map((items) => ({
    y: row.y,
    x: items[0].xMin,
    items,
    text: items.map((item) => item.text).join(" "),
  })));
  const starts = [...new Set(segments.map((segment) => segment.x).sort((left, right) => left - right))];
  const columns = [];
  for (const start of starts) {
    const column = columns.at(-1);
    if (!column || start - column.center > 110) columns.push({ center: start, starts: [start] });
    else {
      column.starts.push(start);
      column.center = column.starts.reduce((total, value) => total + value, 0) / column.starts.length;
    }
  }
  return columns.flatMap((column) => segments
    .filter((segment) => Math.abs(segment.x - column.center) <= 110)
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map((segment, index) => ({
      text: segment.text,
      source: {
        page,
        lineStart: index + 1,
        lineEnd: index + 1,
        text: segment.text,
        format: "pdf",
        items: segment.items.map(({ text, xMin, yMin, xMax, yMax }) => ({ text, xMin, yMin, xMax, yMax })),
      },
    })));
}

export function documentFromPdfBbox(xml) {
  const pages = [];
  const expression = /<page\b[^>]*>([\s\S]*?)<\/page>/gu;
  for (const match of xml.matchAll(expression)) pages.push(match[1]);
  const lines = pages.flatMap((pageXml, index) => pageLines(wordsInPage(pageXml, index + 1), index + 1));
  return { format: "pdf", text: lines.map((line) => line.text).join("\n"), pages: pages.length, lines };
}
