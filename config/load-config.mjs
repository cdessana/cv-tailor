import fs from "node:fs/promises";
import path from "node:path";
import { ConfigSchema } from "./schema.mjs";

const PROJECT_ROOT = process.cwd();

export async function loadConfig(options = {}) {
  const customPath = options.configPath || process.env.CV_TAILOR_CONFIG;
  const targetPath = customPath
    ? path.resolve(PROJECT_ROOT, customPath)
    : path.resolve(PROJECT_ROOT, "cv-tailor.config.json");

  let rawData = {};

  try {
    const fileContent = await fs.readFile(targetPath, "utf8");
    rawData = JSON.parse(fileContent);
  } catch (error) {
    if (customPath || error.code !== "ENOENT") {
      throw new Error(
        `Failed to load configuration file at ${targetPath}: ${error.message}`,
        { cause: error }
      );
    }
    // If optional cv-tailor.config.json is absent, proceed with defaults
  }

  const result = ConfigSchema.safeParse(rawData);

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - ${err.path.join(".")}: ${err.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errorDetails}`);
  }

  const validated = result.data;

  // Normalize and resolve paths against PROJECT_ROOT
  const resolvedPaths = {};
  for (const [key, relativePath] of Object.entries(validated.paths)) {
    resolvedPaths[key] = path.resolve(PROJECT_ROOT, relativePath);
  }

  return {
    ...validated,
    paths: resolvedPaths,
  };
}
