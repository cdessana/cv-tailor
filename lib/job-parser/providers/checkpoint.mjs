import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const CHECKPOINT_VERSION = 1;

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function executionIdentity({ inputText, provider, model, options = {} }) {
  return {
    inputHash: digest(inputText),
    provider,
    model: model ?? null,
    optionsHash: digest(options),
  };
}

export function createCheckpoint(identity, state = {}) {
  return {
    version: CHECKPOINT_VERSION,
    identity,
    updatedAt: new Date().toISOString(),
    ...state,
  };
}

export function isCompatibleCheckpoint(checkpoint, identity) {
  return checkpoint?.version === CHECKPOINT_VERSION &&
    JSON.stringify(checkpoint.identity) === JSON.stringify(identity);
}

export async function readCheckpoint(file, identity) {
  try {
    const checkpoint = JSON.parse(await fs.readFile(file, "utf8"));
    return isCompatibleCheckpoint(checkpoint, identity) ? checkpoint : null;
  } catch {
    return null;
  }
}

export async function writeCheckpoint(file, checkpoint) {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function removeCheckpoint(file) {
  await fs.rm(file, { force: true });
}
