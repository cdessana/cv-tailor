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

export function findEntryConflicts(entries, section) {
  const issues = [];
  const seen = new Map();
  for (const entry of entries) {
    const value = entry.value ?? entry;
    const identity = section === "work" ? key(value, ["name", "position"]) : key(value, ["name", "institution", "language"]);
    const previous = seen.get(identity);
    if (!previous) { seen.set(identity, entry); continue; }
    const previousValue = previous.value ?? previous;
    const conflicting = section === "work" && (previousValue.startDate !== value.startDate || previousValue.endDate !== value.endDate);
    issues.push({
      code: conflicting ? "conflicting_work_dates" : `duplicate_${section}_entry`,
      message: conflicting ? "Matching entries have conflicting dates." : `Duplicate ${section} entry was found.`,
      severity: "warning",
      requiresHumanReview: true,
      candidates: [
        { value: previousValue, source: previous.sources ?? null },
        { value, source: entry.sources ?? null },
      ],
    });
  }
  return issues;
}
