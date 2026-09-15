const SAFE_ALIASES = [
  ["Node.js", ["nodejs", "node js"]],
  ["PostgreSQL", ["postgres"]],
  ["CI/CD", ["ci cd", "ci/cd"]],
];

function escaped(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**
 * Applies only lexical aliases with identical meaning. It deliberately does not
 * normalize related concepts (for example, services -> microservices).
 */
export function normalizeSafeTerminology(value) {
  let result = String(value ?? "");
  for (const [canonical, aliases] of SAFE_ALIASES) {
    const variants = [canonical, ...aliases].sort((left, right) => right.length - left.length);
    result = result.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${variants.map(escaped).join("|")})(?=$|[^\\p{L}\\p{N}])`, "giu"), (_, prefix) => `${prefix}${canonical}`);
  }
  return result.replace(/\s+/g, " ").trim();
}

export function normalizeEvidenceClaim(value) {
  return normalizeSafeTerminology(value);
}
