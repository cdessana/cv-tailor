const normalized = value => value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
const isTeamNoise = value => /\b(?:squad|team|time|equipe|department|departamento|área)\b/iu.test(value);

/** Preserve the existing first-value/refinement policy and all distinct candidates. */
export function mergeMetadataRecord(existing, incoming, key) {
  const plain = record => { const { candidates, ...value } = record; return structuredClone(value); };
  const candidates = [];
  for (const record of [...(existing?.candidates ?? []), existing, ...(incoming.candidates ?? []), incoming].filter(Boolean)) {
    if (!candidates.some(candidate => normalized(candidate.value) === normalized(record.value))) candidates.push(plain(record));
  }
  let selected = existing ?? incoming;
  if (existing) {
    const left = normalized(existing.value), right = normalized(incoming.value);
    const currentNoise = key === "title" && isTeamNoise(existing.value);
    const nextNoise = key === "title" && isTeamNoise(incoming.value);
    if ((currentNoise && !nextNoise) || (currentNoise === nextNoise &&
      ((right.includes(left) && right.length > left.length) ||
       (right === left && incoming.evidence.quote.length > existing.evidence.quote.length)))) selected = incoming;
  }
  return { ...plain(selected), candidates };
}
