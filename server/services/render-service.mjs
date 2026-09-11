import path from "node:path";
import fs from "node:fs/promises";
import { spawnSafe } from "../process/spawn-safe.mjs";

export const SUPPORTED_THEMES = [
  {
    id: "jsonresume-theme-stackoverflow",
    name: "StackOverflow",
    package: "jsonresume-theme-stackoverflow",
    description: "Classic developer theme with strong typographic hierarchy, skills sidebar, and clear timeline",
    recommended: true,
  },
  {
    id: "jsonresume-theme-modern-plain",
    name: "Modern Plain",
    package: "jsonresume-theme-modern-plain",
    description: "Clean, ATS-friendly single-column layout with refined margins and minimal styling",
    recommended: false,
  },
];

export function isThemeSupported(themeName) {
  if (!themeName || typeof themeName !== "string") return false;
  return SUPPORTED_THEMES.some(
    (t) => t.id === themeName || t.package === themeName || t.name.toLowerCase() === themeName.toLowerCase()
  );
}

export function canonicalThemeName(themeName) {
  const found = SUPPORTED_THEMES.find(
    (t) => t.id === themeName || t.package === themeName || t.name.toLowerCase() === themeName.toLowerCase()
  );
  return found ? found.id : null;
}

/**
 * Rerender resume without re-running analysis or tailoring.
 */
export async function renderResume({
  resumePath,
  theme = "jsonresume-theme-stackoverflow",
  outputDir,
}) {
  const canonicalTheme = canonicalThemeName(theme);
  if (!canonicalTheme) {
    throw new Error(
      `Unsupported theme: "${theme}". Supported themes are: ${SUPPORTED_THEMES.map((t) => t.id).join(", ")}`
    );
  }

  const resolvedResumePath = path.resolve(process.cwd(), resumePath);
  const projectRoot = path.resolve(process.cwd());

  // Path traversal check
  if (!resolvedResumePath.startsWith(projectRoot)) {
    throw new Error("Access denied: resumePath is outside project root.");
  }

  try {
    await fs.access(resolvedResumePath);
  } catch {
    throw new Error(`Resume file not found: ${resumePath}`);
  }

  const effectiveOutputDir = outputDir
    ? path.resolve(projectRoot, outputDir)
    : path.dirname(resolvedResumePath);

  if (!effectiveOutputDir.startsWith(projectRoot)) {
    throw new Error("Access denied: outputDir is outside project root.");
  }

  await fs.mkdir(effectiveOutputDir, { recursive: true });

  const args = [
    "scripts/render.mjs",
    resolvedResumePath,
    canonicalTheme,
    "--output-dir",
    effectiveOutputDir,
  ];

  let fullLog = "";
  try {
    const result = await spawnSafe("node", args, {
      cwd: projectRoot,
      onStdout: (chunk) => {
        fullLog += chunk;
      },
      onStderr: (chunk) => {
        fullLog += chunk;
      },
    });

    const htmlPath = path.join(effectiveOutputDir, "resume.html");
    const pdfPath = path.join(effectiveOutputDir, "resume.pdf");
    const txtPath = path.join(effectiveOutputDir, "resume.txt");

    const htmlExists = await fs.access(htmlPath).then(() => true).catch(() => false);
    const pdfExists = await fs.access(pdfPath).then(() => true).catch(() => false);
    const txtExists = await fs.access(txtPath).then(() => true).catch(() => false);

    return {
      success: true,
      theme: canonicalTheme,
      htmlPath: htmlExists ? path.relative(projectRoot, htmlPath) : null,
      pdfPath: pdfExists ? path.relative(projectRoot, pdfPath) : null,
      txtPath: txtExists ? path.relative(projectRoot, txtPath) : null,
      sanityCheckPassed: !fullLog.includes("✗ PDF sanity check failed"),
      logs: fullLog,
    };
  } catch (error) {
    // Check if artifacts were created despite sanity check exit code
    const htmlPath = path.join(effectiveOutputDir, "resume.html");
    const pdfPath = path.join(effectiveOutputDir, "resume.pdf");
    const txtPath = path.join(effectiveOutputDir, "resume.txt");

    const htmlExists = await fs.access(htmlPath).then(() => true).catch(() => false);
    const pdfExists = await fs.access(pdfPath).then(() => true).catch(() => false);
    const txtExists = await fs.access(txtPath).then(() => true).catch(() => false);

    if (htmlExists) {
      return {
        success: true,
        theme: canonicalTheme,
        htmlPath: path.relative(projectRoot, htmlPath),
        pdfPath: pdfExists ? path.relative(projectRoot, pdfPath) : null,
        txtPath: txtExists ? path.relative(projectRoot, txtPath) : null,
        sanityCheckPassed: false,
        warning: "Rendered with sanity check warnings",
        logs: fullLog || error.message,
      };
    }

    throw new Error(`Render failed: ${error.message}\n${fullLog}`, { cause: error });
  }
}
