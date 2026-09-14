import { extractedEntry } from "./extracted-entry.mjs";

function textOf(line) { return typeof line === "string" ? line : line.text; }
function sourceOf(line) { return typeof line === "string" ? null : line.source; }

const emailPattern = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u;
const phonePattern = /\+?\d[\d ()-]{7,}\d/u;
const urlPattern = /https?:\/\/[^\s|]+/gu;
const locationPrefix = /^(?:location|localização|localizacao|based in)\s*:\s*/iu;

function locationFromLine(line) {
  const segments = textOf(line).split(/\s*\|\s*/u).map((value) => value.trim()).filter(Boolean);
  for (const segment of segments) {
    if (emailPattern.test(segment) || phonePattern.test(segment) || /https?:\/\//iu.test(segment)) continue;
    if (/\d{4}/u.test(segment)) continue;
    if (locationPrefix.test(segment)) return segment.replace(locationPrefix, "").trim();
    const parts = segment.split(",").map((value) => value.trim());
    const regionIndex = parts.length === 2 ? 1 : parts.length === 3 ? 1 : -1;
    if (
      /^[^,|]{2,},\s*[^,|]{2,}(?:,\s*[^,|]{2,})?$/u.test(segment)
      && regionIndex >= 0
      && /^[\p{Lu}]{2,3}$/u.test(parts[regionIndex])
    ) return segment;
  }
  return null;
}

function combinedSource(lines, text) {
  const available = lines.map(sourceOf).filter(Boolean);
  if (!available.length) return null;
  if (available.length === 1) return available[0];
  const first = available[0];
  const last = available.at(-1);
  return {
    ...first,
    lineEnd: last.lineEnd ?? last.lineStart ?? first.lineEnd,
    text,
    ...(available.some((source) => source.items) ? { items: available.flatMap((source) => source.items ?? []) } : {}),
  };
}

export function extractBasicsEntry(lines, { summaryLines = [] } = {}) {
  const basics = {};
  const sources = {};
  const emailLine = lines.find((line) => emailPattern.test(textOf(line)));
  const phoneLine = lines.find((line) => phonePattern.test(textOf(line)));
  const locationLine = lines.find((line) => locationFromLine(line));
  const profiles = lines.flatMap((line) => (textOf(line).match(urlPattern) ?? []).map((url) => ({ url, source: sourceOf(line) })));
  const candidates = lines.filter((line) => {
    const text = textOf(line);
    return !emailPattern.test(text)
      && !phonePattern.test(text)
      && !/https?:\/\//iu.test(text)
      && !locationFromLine(line);
  });
  if (candidates[0]) { basics.name = textOf(candidates[0]); sources.name = sourceOf(candidates[0]); }
  if (candidates[1]) { basics.label = textOf(candidates[1]); sources.label = sourceOf(candidates[1]); }
  if (emailLine) { basics.email = textOf(emailLine).match(emailPattern)[0]; sources.email = sourceOf(emailLine); }
  if (phoneLine) { basics.phone = textOf(phoneLine).match(phonePattern)[0]; sources.phone = sourceOf(phoneLine); }
  if (locationLine) { basics.location = { address: locationFromLine(locationLine) }; sources.location = sourceOf(locationLine); }
  if (profiles.length) {
    basics.profiles = profiles.map(({ url }) => ({ network: /linkedin/iu.test(url) ? "LinkedIn" : "Website", url }));
    sources.profiles = profiles.map(({ source }) => source);
  }
  if (summaryLines.length) {
    basics.summary = summaryLines.map(textOf).join(" ");
    sources.summary = combinedSource(summaryLines, basics.summary);
  }
  return extractedEntry(basics, sources);
}
