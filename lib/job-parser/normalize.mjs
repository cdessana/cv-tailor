import { aliasComparisonKey } from "./validate-aliases.mjs";
import {
  aliasIndex,
  assertExtraction,
  defaultAliases,
} from "./extraction-contract.mjs";

/** Return a new intermediate object; preserve the original extraction separately. */
export function normalizeExtraction(extraction, dictionary = defaultAliases) {
  assertExtraction(extraction);
  const index = aliasIndex(dictionary);
  const result = structuredClone(extraction);
  const normalize = (value) => index.get(aliasComparisonKey(value)) ?? value;
  for (const item of result.items) {
    if (item.type === "item") item.value = normalize(item.value);
    else {
      item.values = item.values.map(normalize);
      if (new Set(item.values).size !== item.values.length) {
        throw new Error(
          "Alias normalization collapses alternative options; no normalized result accepted."
        );
      }
    }
  }
  assertExtraction(result);
  return result;
}
