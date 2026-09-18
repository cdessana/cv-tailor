const normalize = (value) => String(value).replace(/\s+/gu, " ").trim();

/**
 * Explicit non-bullet copy sometimes appears immediately below a candidate
 * heading, but it introduces the section rather than stating a qualification.
 */
export function isGenericSectionLead(unit) {
  if (unit.type === "bullet") return false;
  return /^(?:we(?:'re| are) looking for someone who meets the minimum requirements to be considered for the role|the ideal candidate(?: will| should)?|candidates? should meet the following requirements|esperamos de você)\.?$/iu.test(
    normalize(unit.text)
  );
}

/** Company work-policy copy is context, even when a scraper places it before
 * the next context heading. */
export function isCompanyWorkPolicy(unit) {
  if (unit.type === "bullet") return false;
  return /^(?:[\p{L}\p{N}][\p{L}\p{N} .'-]{0,80})\s+is\s+committed\s+to\s+(?:hybrid|remote)\s+work\b/iu.test(
    normalize(unit.text)
  );
}

/** An introductory sentence under a responsibilities heading provides no
 * independent responsibility when the actionable bullets follow it. */
export function isResponsibilityLead(unit) {
  if (unit.type === "bullet") return false;
  return /^(?:(?:como\s+.+,?\s+)?você\s+atuará\s+.+\s+e\s+suas\s+principais\s+atividades\s+serão:?|no seu dia a dia você será responsável por:|o que você fará:?)$/iu.test(
    normalize(unit.text)
  );
}

/** Employer profile and recruitment-integrity notices are not qualifications. */
export function isEmployerPolicyContext(unit) {
  if (unit.type === "bullet") return false;
  const text = normalize(unit.text);
  return /^(?:[\p{L}\p{N}][\p{L}\p{N} .&'-]{0,80})\s+is\s+a\s+(?:leading\s+)?(?:global\s+)?provider\s+of\b/iu.test(text) ||
    /\b(?:zero tolerance policy for candidate fraud|credentials submitted in your application must be truthful and complete)\b/iu.test(text);
}

/** Application instructions, recruiter notes, and signatures are operational
 * copy, even when a source leaves them under a qualifications heading. */
export function isApplicationProcessContext(unit) {
  if (unit.type === "bullet") return false;
  const text = normalize(unit.text);
  return /^(?:if you are interested, please\s+(?:send|submit|apply)\b|note:\s+the recruitment\b|(?:lic|mr|ms|mrs)\.\s+[\p{L}][\p{L} .'-]*\.?$)/iu.test(
    text
  );
}
