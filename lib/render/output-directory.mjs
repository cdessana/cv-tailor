import fs from "node:fs/promises";

export async function ensureOutputDirectory(
  outputDirectory,
  { mkdir = fs.mkdir } = {}
) {
  try {
    await mkdir(outputDirectory, { recursive: true });
  } catch (error) {
    throw new Error(
      `Could not prepare render output directory "${outputDirectory}": ${error.message}`,
      { cause: error }
    );
  }
}
