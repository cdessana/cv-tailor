/**
 * Conservative parser for the text layer of a candidate-provided LinkedIn PDF.
 * It only turns clearly labelled sections into source records; uncertain text
 * stays out of the import rather than becoming an inferred resume claim.
 */
const heading = (line) => line.trim().replace(/:$/u, "").toLowerCase();
const sections = new Map([
  ["about", "about"], ["summary", "about"], ["experience", "experience"], ["education", "education"],
  ["contact", "contact"], ["top skills", "skills"], ["certifications", "certifications"],
  ["licenses & certifications", "certifications"], ["licenses and certifications", "certifications"],
  ["publications", "publications"], ["projects", "projects"], ["languages", "languages"],
  ["volunteer experience", "volunteerExperience"], ["honors & awards", "honors"], ["honors and awards", "honors"], ["recommendations", "recommendations"],
]);
const pageMarker = /^page\s+\d+\s+of\s+\d+$/iu;
const cleanLines = (lines) => lines.map((line) => line.trim().replace(/([a-z])(QA\b)/gu, "$1 $2")).filter((line) => line && !pageMarker.test(line));
const blocks = (lines) => cleanLines(lines).join("\n").split(/\n\s*\n/u).map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean)).filter((block) => block.length);
const ignoredHeaderLines = /^(contact|contact info|profile|linkedin|page \d+( of \d+)?|experience|education)$/iu;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const dateToken = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\\s,]+\\d{4}|\\d{4}";
const periodPattern = new RegExp(`(${dateToken})\\s*(?:[-–—]|to)\\s*(${dateToken}|present|current)`, "iu");
const roleWords = /\b(engineer|developer|analyst|designer|manager|senior|junior|full stack|software|consultant|intern|architect|lead)\b/iu;
const locationWords = /(?:\b(?:area|greater|remote|brazil|brasil)\b|,\s*[A-Z]{2}(?:\b|,))/iu;
const isBulletOrDescription = (line) => /^[•·▪◦-]\s/u.test(line) || line.length > 100 || /\b(design|develop|maintain|built|created|responsible|progressed|supported|executed|prepared)\b/iu.test(line);
const isLikelyPersonName = (line) => /^\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){1,4}$/u.test(line) && !roleWords.test(line) && !ignoredHeaderLines.test(line);
const parsePeriod = (line) => {
  const match = line.match(periodPattern);
  if (!match) return null;
  return { startDate: match[1], ...( !/^(present|current)$/iu.test(match[2]) ? { endDate: match[2] } : {}) };
};
function workEntries(lines) {
  const source = cleanLines(lines);
  let currentCompany;
  const identities = source.flatMap((line, periodIndex) => {
    const period = parsePeriod(line);
    if (!period) return [];
    const windowStart = Math.max(0, periodIndex - 5);
    const candidates = source.slice(windowStart, periodIndex).map((text, offset) => ({ text, index: windowStart + offset })).filter(({ text }) => !isBulletOrDescription(text) && !parsePeriod(text));
    const role = candidates.findLast(({ text }) => roleWords.test(text));
    if (!role) return [];
    const company = [...candidates].reverse().find(({ text, index }) => index !== role.index && !roleWords.test(text) && !locationWords.test(text) && text.length <= 100 && !/^\d+\s+(?:year|month)/iu.test(text));
    if (company) currentCompany = company.text;
    if (!currentCompany) return [];
    return [{ title: role.text, company: currentCompany, ...period, periodIndex, identityStart: Math.min(role.index, company?.index ?? role.index) }];
  });
  return identities.map((identity, index) => {
    const nextStart = identities[index + 1]?.identityStart ?? source.length;
    const detailLines = source.slice(identity.periodIndex + 1, nextStart);
    const location = detailLines.find((line) => !isBulletOrDescription(line) && locationWords.test(line));
    const highlights = [];
    for (const line of detailLines) {
      if (/^[•·▪◦-]\s/u.test(line)) highlights.push(line.replace(/^[•·▪◦-]\s*/u, ""));
      else if (highlights.length && !parsePeriod(line)) highlights[highlights.length - 1] += ` ${line}`;
    }
    const entry = { ...identity };
    delete entry.periodIndex;
    delete entry.identityStart;
    return { ...entry, ...(location ? { location } : {}), ...(highlights.length ? { highlights } : {}) };
  });
}

const degreeWords = /\b(bachelor|master|mba|phd|doctor|engineering|science|degree|tecnologia|graduação|especialização)\b/iu;
function educationEntries(lines) {
  const source = cleanLines(lines);
  const results = [];
  let boundary = 0;
  for (let index = 0; index < source.length; index += 1) {
    const period = parsePeriod(source[index]);
    if (!period) continue;
    const segment = source.slice(boundary, index + 1);
    const degreeIndex = segment.findIndex((line) => degreeWords.test(line));
    if (degreeIndex <= 0) { boundary = index + 1; continue; }
    const institution = segment[degreeIndex - 1];
    const qualification = segment.slice(degreeIndex).join(" ").replace(/\s*[·(]*\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})[\s\S]*$/iu, "").replace(/\s*·\s*$/u, "").trim();
    const [studyType, ...areaParts] = qualification.split(",").map((part) => part.trim()).filter(Boolean);
    if (institution && studyType) results.push({ school: institution, degree: studyType, ...(areaParts.length ? { fieldOfStudy: areaParts.join(", ") } : {}), ...period });
    boundary = index + 1;
  }
  return results;
}

export function linkedInPdfTextToSource(text, { profileUrl } = {}) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((line) => line.trim());
  const result = { profile: {}, skills: [], experience: [], education: [], certifications: [], publications: [], projects: [], languages: [], volunteerExperience: [], honors: [], recommendations: [] };
  if (profileUrl) result.profile.profileUrl = profileUrl;
  const email = lines.map((line) => line.match(emailPattern)?.[0]).find(Boolean);
  if (email) result.profile.email = email;
  const linkedInUrl = lines.find((line) => /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\//iu.test(line));
  if (!profileUrl && linkedInUrl) result.profile.profileUrl = /^https?:\/\//iu.test(linkedInUrl) ? linkedInUrl : `https://${linkedInUrl}`;
  const nameIndex = lines.findIndex((line, index) => isLikelyPersonName(line) && roleWords.test(lines[index + 1] || ""));
  if (nameIndex >= 0) {
    result.profile.name = lines[nameIndex];
    const headlineLines = [];
    for (const line of lines.slice(nameIndex + 1)) {
      if (sections.has(heading(line)) || locationWords.test(line)) break;
      if (line) headlineLines.push(line);
    }
    if (headlineLines.length) result.profile.headline = headlineLines.join(" ");
    const location = lines.slice(nameIndex + 1, nameIndex + 8).find((line) => locationWords.test(line));
    if (location) result.profile.location = location;
  }
  let active;
  const captured = new Map();
  for (const line of lines) {
    const next = sections.get(heading(line));
    if (next) { active = next; if (!captured.has(active)) captured.set(active, []); continue; }
    if (active && !pageMarker.test(line)) captured.get(active).push(line);
  }
  if (!profileUrl && captured.get("contact")) {
    const contact = captured.get("contact").filter(Boolean).join("").replace(/\s*\(LinkedIn\)\s*$/iu, "");
    const match = contact.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\p{L}\p{N}_-]+/iu);
    if (match) result.profile.profileUrl = /^https?:\/\//iu.test(match[0]) ? match[0] : `https://${match[0]}`;
  }
  if (captured.get("about")) result.profile.about = captured.get("about").filter(Boolean).join(" ");
  const generic = (name, fields) => blocks(captured.get(name) || []).map((block) => Object.fromEntries(fields.map(([field, index]) => [field, block[index]]).filter(([, item]) => item))).filter((item) => Object.keys(item).length);
  result.experience = workEntries(captured.get("experience") || []);
  result.education = educationEntries(captured.get("education") || []);
  result.skills = (captured.get("skills") || []).filter(Boolean).map((name) => ({ name }));
  const certificationNames = [];
  for (const line of (captured.get("certifications") || []).filter(Boolean)) {
    if (certificationNames.length && (/^\(/u.test(line) || /^Basics$/iu.test(line))) certificationNames[certificationNames.length - 1] += ` ${line}`;
    else certificationNames.push(line);
  }
  result.certifications = certificationNames.map((name) => ({ name }));
  const publicationTitles = [];
  for (const line of (captured.get("publications") || []).filter(Boolean)) {
    if (line === result.profile.name) break;
    if (!publicationTitles.length || /^\p{Lu}/u.test(line)) publicationTitles.push(line);
    else publicationTitles[publicationTitles.length - 1] += ` ${line}`;
  }
  result.publications = publicationTitles.map((title) => ({ title }));
  result.projects = generic("projects", [["name", 0], ["description", 1]]);
  result.volunteerExperience = generic("volunteerExperience", [["organization", 0], ["role", 1], ["startDate", 2]]);
  result.honors = generic("honors", [["title", 0], ["issuer", 1], ["date", 2]]);
  result.recommendations = generic("recommendations", [["recommender", 0], ["text", 1]]);
  result.languages = (captured.get("languages") || []).filter(Boolean).flatMap((line) => line.split(/[•,]/u)).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.match(/^(.*?)\s*\(([^)]+)\)$/u);
    return match ? { language: match[1].trim(), proficiency: match[2].trim() } : { language: line };
  });
  const detectedToResult = { skills: "skills", experience: "experience", education: "education", certifications: "certifications", publications: "publications", projects: "projects", languages: "languages", volunteerExperience: "volunteerExperience", honors: "honors", recommendations: "recommendations" };
  const emptyDetectedSections = [...captured.keys()].filter((section) => detectedToResult[section] && !result[detectedToResult[section]]?.length);
  result.__diagnostics = { detectedSections: [...captured.keys()], emptyDetectedSections };
  return result;
}
