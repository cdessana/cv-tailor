import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  diagnoseEnvironment,
  diagnosticExitCode,
} from "../lib/doctor/diagnostics.mjs";
import {
  findExecutableOnPath,
  resolveBrowserExecutable,
} from "../lib/render/browser.mjs";

const packageManifest = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

function commandRunner(command, args) {
  const completed = spawnSync(command, args, { encoding: "utf8" });
  return completed.status === 0
    ? {
        ok: true,
        version: (completed.stdout || completed.stderr).trim().split("\n")[0],
      }
    : { ok: false };
}

async function nearestExistingDirectory(target) {
  let candidate = target;
  while (true) {
    try {
      const stats = await fsp.stat(candidate);
      if (stats.isDirectory()) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

export async function inspectConfiguredPaths(paths) {
  const targets = [
    ["baseResume", path.dirname(paths.baseResume), fs.constants.R_OK, false],
    ["evidence", path.dirname(paths.evidence), fs.constants.R_OK, false],
    ["aliases", path.dirname(paths.aliases), fs.constants.R_OK, false],
    ["jobs", paths.jobs, fs.constants.W_OK, true],
    ["output", paths.output, fs.constants.W_OK, true],
  ];
  const issues = [];
  for (const [name, target, mode, mayCreate] of targets) {
    try {
      const targetStats = await fsp.stat(target).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (targetStats && !targetStats.isDirectory())
        throw new Error("Configured path exists but is not a directory.");
      const directory = mayCreate
        ? await nearestExistingDirectory(target)
        : target;
      if (!directory) throw new Error("No existing parent directory.");
      if (!mayCreate && !(await fsp.stat(directory)).isDirectory())
        throw new Error("Configured parent is not a directory.");
      await fsp.access(directory, mode);
    } catch (error) {
      issues.push({
        name,
        message: `${name} path is not ready: ${error.message}`,
      });
    }
  }
  return issues;
}

export async function resolveBrowser({ configuredPath, environmentPath }) {
  let managedPath;
  try {
    const { default: puppeteer } = await import("puppeteer");
    managedPath = puppeteer.executablePath();
  } catch {
    // Report the missing browser through the common result below.
  }
  return resolveBrowserExecutable({
    environmentPath,
    configuredPath,
    managedPath,
  });
}

export async function runDoctor({ json = false, logger = console } = {}) {
  const report = await diagnoseEnvironment({
    loadConfig: async () => {
      const configModule = await import("../config/load-config.mjs");
      return configModule.loadConfig();
    },
    packageManifest,
    resolveDependency(name) {
      try {
        import.meta.resolve(name);
        return true;
      } catch {
        return false;
      }
    },
    commandRunner,
    commandLocator: findExecutableOnPath,
    resolveBrowser,
    inspectConfiguredPaths,
  });

  if (json) {
    logger.log(JSON.stringify(report, null, 2));
  } else {
    logger.log("CV Tailor environment diagnostic\n");
    for (const check of report.checks) {
      const marker =
        check.status === "pass" ? "PASS" : check.status.toUpperCase();
      logger.log(`[${marker}] ${check.label}: ${check.message}`);
      if (check.action) logger.log(`       Action: ${check.action}`);
    }
    logger.log(`\nStatus: ${report.status.toUpperCase()}`);
  }
  return report;
}

export async function runDoctorCli(
  argv,
  { run = runDoctor, logger = console } = {}
) {
  const unsupported = argv.filter((argument) => argument !== "--json");
  if (unsupported.length) {
    logger.error(`Unknown option: ${unsupported[0]}`);
    return 1;
  }
  const report = await run({ json: argv.includes("--json"), logger });
  return diagnosticExitCode(report.status);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runDoctorCli(process.argv.slice(2));
}
