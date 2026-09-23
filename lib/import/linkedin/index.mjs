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
const comparableText = (input) => text(input)?.replace(/\s+/gu, " ").toLocaleLowerCase();

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
const matchRules = {
  skills: { exact: ["name"], identity: ["name"], possible: ["name"] },
  work: { exact: ["name", "position", "startDate", "endDate", "location"], identity: ["name", "position"], conflict: ["startDate", "endDate", "location"], possible: ["name", "position"] },
  education: { exact: ["institution", "studyType", "area", "startDate", "endDate"], identity: ["institution", "studyType", "area"], conflict: ["startDate", "endDate"], possible: ["institution", "studyType"] },
  certificates: { exact: ["name", "issuer", "date", "url"], identity: ["name", "issuer"], conflict: ["date", "url"], possible: ["name"] },
  publications: { exact: ["name", "publisher", "releaseDate", "url", "summary"], possible: ["name"] },
  projects: { exact: ["name", "description", "startDate", "endDate", "url"], possible: ["name"] },
  languages: { exact: ["language", "fluency"], identity: ["language"], conflict: ["fluency"], possible: ["language"] },
  volunteer: { exact: ["organization", "position", "startDate", "endDate", "summary"], identity: ["organization", "position"], conflict: ["startDate", "endDate"], possible: ["organization", "position"] },
  awards: { exact: ["title", "awarder", "date", "summary"], identity: ["title", "awarder"], conflict: ["date"], possible: ["title"] },
};

function sameField(left, right, field) {
  const a = comparableText(left?.[field]);
  const b = comparableText(right?.[field]);
  return a !== undefined && b !== undefined && a === b;
}

function sameFields(left, right, fields = []) {
  return fields.length > 0 && fields.every((field) => sameField(left, right, field));
}

function exactFields(left, right, fields = []) {
  return fields.length > 0 && fields.every((field) => comparableText(left?.[field]) === comparableText(right?.[field]));
}

function classifyListMatch(existing, candidate, section, dateReview = []) {
  const rules = matchRules[section];
  if (!rules || !Array.isArray(existing)) return { classification: "new" };
  const exact = dateReview.length ? undefined : existing.find((entry) => exactFields(entry, candidate, rules.exact));
  if (exact) return { classification: "exact_duplicate", existing: exact, matchReason: "All section-specific identity and comparison fields match." };
  const identity = existing.find((entry) => sameFields(entry, candidate, rules.identity));
  if (identity && dateReview.length) return { classification: "possible_duplicate", existing: identity, matchReason: "The source has an unsupported date format for an otherwise similar record." };
  if (identity && (rules.conflict || []).some((field) => {
    const a = comparableText(identity[field]); const b = comparableText(candidate[field]);
    return a !== undefined && b !== undefined && a !== b;
  })) return { classification: "conflict", existing: identity, matchReason: "A section-specific identity matches but a material field disagrees." };
  const possible = existing.find((entry) => sameFields(entry, candidate, rules.possible));
  if (possible) return { classification: "possible_duplicate", existing: possible, matchReason: "The record shares conservative identity signals but has non-trivial differences." };
  return { classification: "new" };
}

const dateInputs = {
  work: { startDate: ["startDate", "start_date", "start"], endDate: ["endDate", "end_date", "end"] },
  education: { startDate: ["startDate", "start_date", "start"], endDate: ["endDate", "end_date", "end"] },
  certificates: { date: ["issueDate", "date", "issued"] },
  publications: { releaseDate: ["publicationDate", "date", "releaseDate"] },
  projects: { startDate: ["startDate", "start_date", "start"], endDate: ["endDate", "end_date", "end"] },
  volunteer: { startDate: ["startDate", "start_date", "start"], endDate: ["endDate", "end_date", "end"] },
  awards: { date: ["date", "issueDate"] },
};

function mapSection(section, item) {
  const candidate = mappers[section](item);
  const dateReview = [];
  for (const [field, keys] of Object.entries(dateInputs[section] ?? {})) {
    const sourceDate = text(value(item, ...keys));
    if (sourceDate && !candidate[field] && !/^(present|current|ongoing|now)$/iu.test(sourceDate)) {
      dateReview.push({ field, sourceDate, dateStatus: "review_required" });
    }
  }
  return { candidate, dateReview };
}

export function importLinkedIn(rawSource, base = {}) {
  const source = sourceSections(rawSource);
  const records = [], sections = {};
  const add = (section, candidate, mappingStatus = "mapped", { dateReview = [] } = {}) => {
    if (!Object.keys(candidate).length) return;
    const match = mappingStatus === "mapped" ? classifyListMatch(base[section], candidate, section, dateReview) : { classification: mappingStatus };
    const reviewStatus = match.classification === "exact_duplicate" ? "duplicate" : match.classification === "new" && dateReview.length ? "review_required" : match.classification === "new" ? "pending" : match.classification;
    records.push({ id: stableId(section, candidate), section, candidate, source: { type: "linkedin", section }, mappingStatus, classification: match.classification, reviewStatus, ...(match.existing ? { existing: match.existing, matchReason: match.matchReason } : {}), ...(dateReview.length ? { dateReview } : {}) });
    sections[section] = { itemsFound: (sections[section]?.itemsFound || 0) + 1, ...(mappingStatus !== "mapped" ? { mappingStatus } : {}) };
  };
  const profile = source.profile || source.basics || source;
  const rawLocation = text(value(profile, "location"));
  // JSON Resume requires an object here. `raw` preserves the exact LinkedIn
  // location without guessing whether its parts are city, region, or country.
  const basics = compact({ name: text(value(profile, "name", "fullName")), label: text(value(profile, "headline", "label")), summary: text(value(profile, "about", "summary")), email: text(value(profile, "email")), phone: text(value(profile, "phone")), ...(rawLocation ? { location: { raw: rawLocation } } : {}) });
  for (const [field, candidate] of Object.entries(basics)) {
    const current = field === "profiles" ? (base.basics?.profiles || []).find((p) => String(p.network).toLowerCase() === "linkedin") : base.basics?.[field];
    const classification = current && key(current) !== key(candidate) ? "conflict" : "new";
    records.push({ id: `linkedin-${field === "summary" ? "about" : `basics-${field}`}`, section: field === "summary" ? "about" : "basics", field, candidate, ...(current ? { existing: current } : {}), ...(classification === "conflict" ? { matchReason: "An existing profile field differs from the imported value." } : {}), source: { type: "linkedin", section: field === "summary" ? "about" : "profile" }, mappingStatus: "mapped", classification, reviewStatus: classification === "conflict" ? "conflict" : "pending" });
    sections[field === "summary" ? "about" : "basics"] = { itemsFound: (sections[field === "summary" ? "about" : "basics"]?.itemsFound || 0) + 1 };
  }
  const profileUrl = text(value(profile, "profileUrl", "linkedinUrl"));
  if (profileUrl) {
    const candidate = { network: "LinkedIn", url: profileUrl };
    const existing = (base.basics?.profiles || []).find((entry) => comparableText(entry.network) === "linkedin");
    const classification = existing ? (comparableText(existing.url) === comparableText(candidate.url) ? "exact_duplicate" : "conflict") : "new";
    records.push({ id: stableId("profile-linkedin", candidate), section: "basics", field: "profiles", candidate, ...(existing ? { existing, matchReason: classification === "conflict" ? "An existing LinkedIn profile has a different URL." : "The LinkedIn profile URL matches." } : {}), source: { type: "linkedin", section: "profile" }, mappingStatus: "mapped", classification, reviewStatus: classification === "exact_duplicate" ? "duplicate" : classification === "conflict" ? "conflict" : "pending" });
    sections.basics = { itemsFound: (sections.basics?.itemsFound || 0) + 1 };
  }
  for (const [section, names] of Object.entries(aliases)) for (const name of names) for (const item of list(source, name)) {
    const mapped = mapSection(section, typeof item === "string" ? { name: item, language: item } : item);
    add(section, mapped.candidate, "mapped", mapped);
  }
  for (const item of list(source, "recommendations", "testimonials")) add("recommendations", compact({ name: text(value(item, "recommender", "name")), role: text(value(item, "role", "context", "relationship")), text: text(value(item, "text", "recommendation", "body")) }), "supporting_material");
  const known = new Set([...Object.values(aliases).flat(), "profile", "basics", "recommendations", "testimonials", "sections", "name", "fullName", "headline", "label", "about", "summary", "email", "phone", "location", "profileUrl", "linkedinUrl", "url", "__diagnostics"]);
  for (const [name, item] of Object.entries(source)) if (!known.has(name) && item != null) add("unmapped", { name, value: item }, "unmapped");
  const summary = { sectionsFound: Object.keys(sections).length, itemsFound: records.length, ready: records.filter((r) => r.reviewStatus === "pending" && r.mappingStatus === "mapped").length, duplicates: records.filter((r) => r.classification === "exact_duplicate").length, possibleDuplicates: records.filter((r) => r.classification === "possible_duplicate").length, conflicts: records.filter((r) => r.classification === "conflict").length, reviewRequired: records.filter((r) => r.reviewStatus === "review_required").length, unmapped: records.filter((r) => r.mappingStatus !== "mapped").length };
  const diagnostics = source.__diagnostics || { detectedSections: [], emptyDetectedSections: [] };
  return { status: summary.conflicts || summary.duplicates || summary.possibleDuplicates || summary.reviewRequired || diagnostics.emptyDetectedSections.length ? "review_required" : "pending_review", source: "linkedin", summary, sections, records, diagnostics };
}

export function applyLinkedInImport(base, report, decisions = []) {
  const choice = new Map(decisions.map((d) => [d.id, d]));
  const next = structuredClone(base);
  const unresolved = report.records.filter((r) => r.mappingStatus === "mapped" && !["approved", "rejected", "keep_existing"].includes(choice.get(r.id)?.status));
  if (unresolved.length) return { error: "LINKEDIN_REVIEW_REQUIRED", unresolved: unresolved.map((r) => r.id) };
  const blocked = report.records.filter((r) => r.mappingStatus === "mapped" && ["possible_duplicate", "conflict"].includes(r.classification) && choice.get(r.id)?.status === "approved");
  if (blocked.length) return { error: "LINKEDIN_REVIEW_REQUIRED", unresolved: blocked.map((r) => r.id) };
  for (const record of report.records) {
    const decision = choice.get(record.id); if (record.mappingStatus !== "mapped" || decision?.status !== "approved") continue;
    if (record.classification === "exact_duplicate") continue;
    if (record.section === "basics" || record.section === "about") { next.basics ||= {}; if (record.field === "profiles") { const others = (next.basics.profiles || []).filter((p) => comparableText(p.network) !== "linkedin"); next.basics.profiles = [...others, record.candidate]; } else next.basics[record.field] = record.candidate; continue; }
    next[record.section] ||= []; if (classifyListMatch(next[record.section], record.candidate, record.section).classification !== "exact_duplicate") next[record.section].push(record.candidate);
  }
  return { resume: next };
}
