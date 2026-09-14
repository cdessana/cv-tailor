function key(entry, fields) {
  return fields.map((field) => String(entry[field] ?? "").trim().toLowerCase()).join("\u0000");
}

export function findConflicts(resume) {
  const issues = [];
  const seenWork = new Map();
  for (const entry of resume.work ?? []) {
    const identity = key(entry, ["name", "position"]);
    const existing = seenWork.get(identity);
    if (existing && (existing.startDate !== entry.startDate || existing.endDate !== entry.endDate)) {
      issues.push({ code: "conflicting_work_dates", message: "Matching company and role have conflicting dates.", sourceText: `${entry.name} / ${entry.position}`, severity: "warning", requiresHumanReview: true, candidates: [existing, entry] });
    } else if (existing) {
      issues.push({ code: "duplicate_work_entry", message: "Duplicate work entry was found.", sourceText: `${entry.name} / ${entry.position}`, severity: "warning", requiresHumanReview: true });
    } else seenWork.set(identity, entry);
  }
  const seenCertificates = new Set();
  for (const entry of resume.certificates ?? []) {
    const identity = key(entry, ["name", "issuer"]);
    if (seenCertificates.has(identity)) issues.push({ code: "duplicate_certificate", message: "Duplicate certificate was found.", sourceText: entry.name, severity: "warning", requiresHumanReview: true });
    seenCertificates.add(identity);
  }
  return issues;
}
