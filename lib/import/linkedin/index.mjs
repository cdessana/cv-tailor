import crypto from "node:crypto";

const text = (value) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const value = (source, ...keys) => {
  for (const key of keys) {
    const found = source?.[key];
    if (found !== undefined && found !== null && `${found}`.trim()) return found;
  }
  return undefined;
};
const list = (source, ...keys) => {
  const found = value(source, ...keys);
  return Array.isArray(found) ? found : found ? [found] : [];
};
const slug = (input) => String(input ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "item";
const stableId = (section, data) => `linkedin-${section}-${slug(Object.values(data).filter(Boolean).join("-"))}-${crypto.createHash("sha1").update(JSON.stringify(data)).digest("hex").slice(0, 8)}`;
const key = (data) => JSON.stringify(data, Object.keys(data).sort()).toLowerCase();

/** Preserve LinkedIn date precision; deliberately do not manufacture days or months. */
export function linkedInDate(input) {
  const raw = text(input);
  if (!raw || /^(present|current|ongoing|now)$/i.test(raw)) return undefined;
  if (/^\d{4}(-\d{2})?$/u.test(raw)) return raw;
  const parsed = raw.match(/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s,]+(\d{4})$/iu);
  if (!parsed) return undefined;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].findIndex((m) => raw.toLowerCase().startsWith(m));
  return `${parsed[1]}-${String(month + 1).padStart(2, "0")}`;
}

function compact(object) { return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== "" && (!Array.isArray(v) || v.length))); }
function sourceSections(raw) { return raw?.sections && typeof raw.sections === "object" ? { ...raw, ...raw.sections } : raw || {}; }

const mappers = {
  skills: (x) => compact({ name: text(value(x, "name", "category")), keywords: list(x, "keywords").map(text).filter(Boolean) }),
  work: (x) => compact({ name: text(value(x, "company", "name", "organization")), position: text(value(x, "title", "position", "role")), location: text(value(x, "location")), summary: text(value(x, "description", "summary")), startDate: linkedInDate(value(x, "startDate", "start_date", "start")), endDate: linkedInDate(value(x, "endDate", "end_date", "end")), highlights: list(x, "highlights", "activities").map(text).filter(Boolean) }),
  education: (x) => compact({ institution: text(value(x, "school", "institution", "name")), studyType: text(value(x, "degree", "studyType", "degreeName")), area: text(value(x, "fieldOfStudy", "field", "area")), startDate: linkedInDate(value(x, "startDate", "start_date", "start")), endDate: linkedInDate(value(x, "endDate", "end_date", "end")) }),
  certificates: (x) => compact({ name: text(value(x, "name", "title")), issuer: text(value(x, "issuer", "issuingOrganization", "organization")), date: linkedInDate(value(x, "issueDate", "date", "issued")), url: text(value(x, "credentialUrl", "url")) }),
  publications: (x) => compact({ name: text(value(x, "title", "name")), publisher: text(value(x, "publisher")), releaseDate: linkedInDate(value(x, "publicationDate", "date", "releaseDate")), url: text(value(x, "url", "publicationUrl")), summary: text(value(x, "description", "summary")) }),
  projects: (x) => compact({ name: text(value(x, "name", "title")), description: text(value(x, "description", "summary")), startDate: linkedInDate(value(x, "startDate", "start_date", "start")), endDate: linkedInDate(value(x, "endDate", "end_date", "end")), url: text(value(x, "url", "projectUrl")) }),
  languages: (x) => compact({ language: text(value(x, "language", "name")), fluency: text(value(x, "proficiency", "fluency", "level")) }),
  volunteer: (x) => compact({ organization: text(value(x, "organization", "company", "name")), position: text(value(x, "role", "position", "title")), summary: text(value(x, "description", "summary")), startDate: linkedInDate(value(x, "startDate", "start_date", "start")), endDate: linkedInDate(value(x, "endDate", "end_date", "end")), highlights: list(x, "highlights", "activities").map(text).filter(Boolean) }),
  awards: (x) => compact({ title: text(value(x, "title", "name")), awarder: text(value(x, "issuer", "awarder", "organization")), date: linkedInDate(value(x, "date", "issueDate")), summary: text(value(x, "description", "summary")) }),
};

const aliases = { skills: ["skills", "topSkills"], work: ["work", "experience", "experiences", "positions"], education: ["education", "educations"], certificates: ["certificates", "certifications", "licenses"], publications: ["publications"], projects: ["projects"], languages: ["languages"], volunteer: ["volunteer", "volunteerExperience", "volunteering"], awards: ["awards", "honors", "honorsAwards"] };
const comparable = { skills: ["name"], work: ["name", "position", "startDate"], education: ["institution", "studyType", "area", "startDate", "endDate"], certificates: ["name", "issuer", "date"], publications: ["name", "publisher", "releaseDate", "url"], projects: ["name", "startDate", "url"], languages: ["language"], volunteer: ["organization", "position", "startDate"], awards: ["title", "awarder", "date"] };
function match(existing, candidate, section) { const fields = comparable[section]; return (existing || []).some((entry) => fields.every((field) => !candidate[field] || !entry[field] || String(entry[field]).toLowerCase() === String(candidate[field]).toLowerCase())); }

export function importLinkedIn(rawSource, base = {}) {
  const source = sourceSections(rawSource);
  const records = [], sections = {};
  const add = (section, candidate, mappingStatus = "mapped") => {
    if (!Object.keys(candidate).length) return;
    const duplicate = mappingStatus === "mapped" && Array.isArray(base[section]) && match(base[section], candidate, section);
    records.push({ id: stableId(section, candidate), section, candidate, source: { type: "linkedin", section }, mappingStatus, reviewStatus: duplicate ? "duplicate" : "pending" });
    sections[section] = { itemsFound: (sections[section]?.itemsFound || 0) + 1, ...(mappingStatus !== "mapped" ? { mappingStatus } : {}) };
  };
  const profile = source.profile || source.basics || source;
  const rawLocation = text(value(profile, "location"));
  // JSON Resume requires an object here. `raw` preserves the exact LinkedIn
  // location without guessing whether its parts are city, region, or country.
  const basics = compact({ name: text(value(profile, "name", "fullName")), label: text(value(profile, "headline", "label")), summary: text(value(profile, "about", "summary")), email: text(value(profile, "email")), phone: text(value(profile, "phone")), ...(rawLocation ? { location: { raw: rawLocation } } : {}) });
  for (const [field, candidate] of Object.entries(basics)) {
    const current = field === "profiles" ? (base.basics?.profiles || []).find((p) => String(p.network).toLowerCase() === "linkedin") : base.basics?.[field];
    records.push({ id: `linkedin-${field === "summary" ? "about" : `basics-${field}`}`, section: field === "summary" ? "about" : "basics", field, candidate, existing: current, source: { type: "linkedin", section: field === "summary" ? "about" : "profile" }, mappingStatus: "mapped", reviewStatus: current && key(current) !== key(candidate) ? "conflict" : "pending" });
    sections[field === "summary" ? "about" : "basics"] = { itemsFound: (sections[field === "summary" ? "about" : "basics"]?.itemsFound || 0) + 1 };
  }
  for (const [section, names] of Object.entries(aliases)) for (const name of names) for (const item of list(source, name)) add(section, mappers[section](typeof item === "string" ? { name: item, language: item } : item));
  for (const item of list(source, "recommendations", "testimonials")) add("recommendations", compact({ name: text(value(item, "recommender", "name")), role: text(value(item, "role", "context", "relationship")), text: text(value(item, "text", "recommendation", "body")) }), "supporting_material");
  const known = new Set([...Object.values(aliases).flat(), "profile", "basics", "recommendations", "testimonials", "sections", "name", "fullName", "headline", "label", "about", "summary", "email", "phone", "location", "profileUrl", "linkedinUrl", "url", "__diagnostics"]);
  for (const [name, item] of Object.entries(source)) if (!known.has(name) && item != null) add("unmapped", { name, value: item }, "unmapped");
  const summary = { sectionsFound: Object.keys(sections).length, itemsFound: records.length, ready: records.filter((r) => r.reviewStatus === "pending" && r.mappingStatus === "mapped").length, duplicates: records.filter((r) => r.reviewStatus === "duplicate").length, conflicts: records.filter((r) => r.reviewStatus === "conflict").length, unmapped: records.filter((r) => r.mappingStatus !== "mapped").length };
  const diagnostics = source.__diagnostics || { detectedSections: [], emptyDetectedSections: [] };
  return { status: summary.conflicts || summary.duplicates || diagnostics.emptyDetectedSections.length ? "review_required" : "pending_review", source: "linkedin", summary, sections, records, diagnostics };
}

export function applyLinkedInImport(base, report, decisions = []) {
  const choice = new Map(decisions.map((d) => [d.id, d]));
  const next = structuredClone(base);
  const unresolved = report.records.filter((r) => r.mappingStatus === "mapped" && !["approved", "rejected", "keep_existing"].includes(choice.get(r.id)?.status));
  if (unresolved.length) return { error: "LINKEDIN_REVIEW_REQUIRED", unresolved: unresolved.map((r) => r.id) };
  for (const record of report.records) {
    const decision = choice.get(record.id); if (record.mappingStatus !== "mapped" || decision?.status !== "approved") continue;
    if (record.section === "basics" || record.section === "about") { next.basics ||= {}; if (record.field === "profiles") { const others = (next.basics.profiles || []).filter((p) => String(p.network).toLowerCase() !== "linkedin"); next.basics.profiles = [...others, ...record.candidate]; } else next.basics[record.field] = record.candidate; continue; }
    next[record.section] ||= []; if (!match(next[record.section], record.candidate, record.section)) next[record.section].push(record.candidate);
  }
  return { resume: next };
}
