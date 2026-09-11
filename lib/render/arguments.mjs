export function parseRenderArguments(argv) {
  let resumePath;
  let theme;
  let outputDirectory;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output-dir") {
      if (outputDirectory !== undefined)
        throw new Error("--output-dir may be provided only once.");
      const value = argv[++index];
      if (!value || value.startsWith("--"))
        throw new Error("--output-dir requires a directory.");
      outputDirectory = value;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!resumePath) {
      resumePath = argument;
    } else if (!theme) {
      theme = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }
  if (!resumePath)
    throw new Error(
      "Usage: node scripts/render.mjs <resume-final.json> [theme] [--output-dir directory]"
    );
  return { resumePath, theme, outputDirectory };
}
