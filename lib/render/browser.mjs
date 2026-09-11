import fs from "node:fs";
import path from "node:path";

export function isExecutableFile(candidate, platform = process.platform) {
  if (!candidate) return false;
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(
      candidate,
      platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

export function findExecutableOnPath(
  command,
  { env = process.env, platform = process.platform } = {}
) {
  const extensions =
    platform === "win32"
      ? (env.PATHEXT || ".EXE;.CMD;.BAT")
          .split(";")
          .filter(Boolean)
          .map((extension) => extension.toLowerCase())
      : [""];
  for (const directory of (env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (isExecutableFile(candidate, platform)) return candidate;
    }
  }
  return null;
}

export function resolveBrowserExecutable({
  environmentPath,
  configuredPath,
  managedPath,
  inspect = isExecutableFile,
} = {}) {
  for (const [source, candidate] of [
    ["environment", environmentPath],
    ["configuration", configuredPath],
  ]) {
    if (!candidate) continue;
    return inspect(candidate)
      ? { available: true, path: candidate, source }
      : {
          available: false,
          source,
          message: `The browser path from ${source} is not an executable file: ${candidate}.`,
        };
  }
  return managedPath && inspect(managedPath)
    ? { available: true, path: managedPath, source: "puppeteer" }
    : {
        available: false,
        source: "puppeteer",
        message: "No usable Puppeteer-managed browser was found.",
      };
}
