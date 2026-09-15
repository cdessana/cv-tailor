import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateEvidenceStructure } from "./canonical-schema.mjs";

export async function promoteApprovedEvidence(evidence, targetPath) {
  validateEvidenceStructure(evidence);
  const destination = path.resolve(targetPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const token = randomUUID();
  const tempPath = `${destination}.${token}.tmp`;
  const backupPath = `${destination}.${token}.bak`;
  let backedUp = false;
  let installed = false;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    try { await fs.rename(destination, backupPath); backedUp = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    await fs.rename(tempPath, destination);
    installed = true;
    await fs.rm(backupPath, { force: true });
  } catch (error) {
    await Promise.allSettled([
      fs.rm(tempPath, { force: true }),
      installed ? fs.rm(destination, { force: true }) : Promise.resolve(),
      backedUp ? fs.rename(backupPath, destination) : Promise.resolve(),
    ]);
    throw error;
  }
  return evidence;
}
