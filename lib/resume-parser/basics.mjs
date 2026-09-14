import { extractedEntry } from "./extracted-entry.mjs";

function textOf(line) { return typeof line === "string" ? line : line.text; }
function sourceOf(line) { return typeof line === "string" ? null : line.source; }

export function extractBasicsEntry(lines) {
  const basics = {};
  const sources = {};
  const emailLine = lines.find((line) => /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(textOf(line)));
  const phoneLine = lines.find((line) => /\+?\d[\d ()-]{7,}\d/u.test(textOf(line)));
  const urlLine = lines.find((line) => /https?:\/\//iu.test(textOf(line)));
  const candidates = lines.filter((line) => !textOf(line).includes("@") && !/^https?:/iu.test(textOf(line)) && !/\+?\d[\d ()-]{7,}\d/u.test(textOf(line)));
  if (candidates[0]) { basics.name = textOf(candidates[0]); sources.name = sourceOf(candidates[0]); }
  if (candidates[1]) { basics.label = textOf(candidates[1]); sources.label = sourceOf(candidates[1]); }
  if (emailLine) { basics.email = textOf(emailLine).match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u)[0]; sources.email = sourceOf(emailLine); }
  if (phoneLine) { basics.phone = textOf(phoneLine).match(/\+?\d[\d ()-]{7,}\d/u)[0]; sources.phone = sourceOf(phoneLine); }
  if (urlLine) { basics.profiles = textOf(urlLine).match(/https?:\/\/[^\s|]+/gu).map((url) => ({ network: /linkedin/iu.test(url) ? "LinkedIn" : "Website", url })); sources.profiles = [sourceOf(urlLine)]; }
  return extractedEntry(basics, sources);
}
