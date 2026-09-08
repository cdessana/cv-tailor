const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

function invalid(message) {
  const error = new Error(`GEMINI_RESPONSE_ERROR: ${message}`);
  error.code = "GEMINI_RESPONSE_ERROR";
  return error;
}

/** Decode once, rejecting lossy or ambiguous responses before block validation. */
export function decodeGeminiResponse(payload, targetIds) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || !parts.every(object)) throw invalid("Expected response content parts.");
  const calls = parts.filter(part => Object.hasOwn(part, "functionCall"));
  let blocks;
  if (calls.length) {
    blocks = Object.create(null);
    for (const { functionCall: call } of calls) {
      if (!object(call) || call.name !== "extract_block") throw invalid("Unexpected function name; expected extract_block.");
      if (!object(call.args) || typeof call.args.id !== "string") throw invalid("Expected function arguments with a string block ID.");
      const { id, ...record } = call.args;
      if (!targetIds.includes(id)) throw invalid(`Unknown block ID: ${id}.`);
      if (Object.hasOwn(blocks, id)) throw invalid(`Duplicate block ID: ${id}. Return one call containing all records for this block.`);
      blocks[id] = record;
    }
  } else {
    // Retain the existing JSON fallback, but require one unambiguous envelope.
    const texts = parts.filter(part => typeof part.text === "string" && part.text.trim());
    if (texts.length !== 1) throw invalid("Expected function calls or one JSON block response.");
    let parsed;
    try { parsed = JSON.parse(texts[0].text); } catch { throw invalid("Gemini returned non-JSON text."); }
    if (!object(parsed) || Object.keys(parsed).length !== 1 || !object(parsed.blocks)) throw invalid("Expected a blocks object.");
    blocks = parsed.blocks;
  }
  const unknown = Object.keys(blocks).filter(id => !targetIds.includes(id));
  const missing = targetIds.filter(id => !Object.hasOwn(blocks, id));
  if (unknown.length || missing.length) throw invalid(`Unknown blocks: ${unknown.join(", ") || "none"}; missing blocks: ${missing.join(", ") || "none"}.`);
  return { blocks: structuredClone(blocks) };
}
