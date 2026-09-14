const REQUIRED_NODE_MAJOR = 22;

function result(id, label, category, status, message, action) {
  return {
    id,
    label,
    category,
    status,
    message,
    ...(action ? { action } : {}),
  };
}

async function commandCheck(commandRunner, command, label, action) {
  let commandResult = await commandRunner(command, ["--version"]);
  if (!commandResult?.ok) {
    const altResult = await commandRunner(command, ["-v"]);
    if (altResult?.ok) {
      commandResult = altResult;
    }
  }
  return commandResult?.ok
    ? result(
        command,
        label,
        "required",
        "pass",
        commandResult.version || "Available."
      )
    : result(command, label, "required", "fail", "Not available.", action);
}

export async function diagnoseEnvironment({
  env = process.env,
  nodeVersion = process.versions.node,
  loadConfig,
  packageManifest,
  resolveDependency,
  commandRunner,
  commandLocator,
  resolveBrowser,
  inspectConfiguredPaths,
} = {}) {
  const checks = [];
  const [npmCheck, pdftotextCheck, pdfinfoCheck] = await Promise.all([
    commandCheck(
      commandRunner,
      "npm",
      "npm",
      "Install npm and ensure it is available on PATH."
    ),
    commandCheck(
      commandRunner,
      "pdftotext",
      "Poppler pdftotext",
      "Install Poppler and ensure pdftotext is available on PATH."
    ),
    commandCheck(
      commandRunner,
      "pdfinfo",
      "Poppler pdfinfo",
      "Install Poppler and ensure pdfinfo is available on PATH."
    ),
  ]);
  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0], 10);
  checks.push(
    Number.isInteger(nodeMajor) && nodeMajor >= REQUIRED_NODE_MAJOR
      ? result("node", "Node.js", "required", "pass", `Version ${nodeVersion}.`)
      : result(
          "node",
          "Node.js",
          "required",
          "fail",
          `Version ${nodeVersion}; version ${REQUIRED_NODE_MAJOR} or newer is required.`,
          `Install Node.js ${REQUIRED_NODE_MAJOR}+ and run the diagnostic again.`
        )
  );

  checks.push(npmCheck);

  const dependencyNames = [
    ...Object.keys(packageManifest.dependencies ?? {}),
    ...Object.keys(packageManifest.devDependencies ?? {}),
  ];
  const missingDependencies = dependencyNames.filter(
    (name) => !resolveDependency(name)
  );
  checks.push(
    missingDependencies.length
      ? result(
          "dependencies",
          "npm dependencies",
          "required",
          "fail",
          `Missing: ${missingDependencies.join(", ")}.`,
          "Run npm install."
        )
      : result(
          "dependencies",
          "npm dependencies",
          "required",
          "pass",
          `${dependencyNames.length} declared packages are available.`
        )
  );

  let config;
  try {
    config = await loadConfig();
    checks.push(
      result(
        "configuration",
        "Configuration",
        "required",
        "pass",
        "Configuration and paths are valid."
      )
    );
  } catch (error) {
    checks.push(
      result(
        "configuration",
        "Configuration",
        "required",
        "fail",
        error.message,
        "Correct the configuration file and run the diagnostic again."
      )
    );
  }

  const expectedPaths = ["baseResume", "evidence", "aliases", "jobs", "output"];
  const missingPaths = expectedPaths.filter(
    (name) => typeof config?.paths?.[name] !== "string" || !config.paths[name]
  );
  const pathIssues = missingPaths.length
    ? []
    : await inspectConfiguredPaths(config.paths);
  checks.push(
    missingPaths.length || pathIssues.length
      ? result(
          "paths",
          "Configured paths",
          "required",
          "fail",
          missingPaths.length
            ? `Missing path settings: ${missingPaths.join(", ")}.`
            : pathIssues.map((issue) => issue.message).join(" "),
          missingPaths.length
            ? "Define all paths.* settings or restore their defaults."
            : "Create the missing directories or correct their permissions."
        )
      : result(
          "paths",
          "Configured paths",
          "required",
          "pass",
          "Résumé, evidence, aliases, jobs, and output paths are configured."
        )
  );

  const browser = await resolveBrowser({
    configuredPath: config?.render?.browserExecutable,
    environmentPath: env.PUPPETEER_EXECUTABLE_PATH,
  });
  checks.push(
    browser.available
      ? result(
          "browser",
          "Chrome/Chromium",
          "required",
          "pass",
          `Available at ${browser.path}.`
        )
      : result(
          "browser",
          "Chrome/Chromium",
          "required",
          "fail",
          browser.message || "No usable browser executable was found.",
          "Install Puppeteer's browser or configure render.browserExecutable/PUPPETEER_EXECUTABLE_PATH."
        )
  );

  checks.push(pdftotextCheck, pdfinfoCheck);

  const ollamaPath = commandLocator("ollama");
  const ollamaOptions = config?.jobParser?.providers?.ollama;
  const ollamaConfigured = Boolean(ollamaOptions?.model && ollamaOptions?.url);
  checks.push(
    ollamaPath && ollamaConfigured
      ? result(
          "ollama",
          "Ollama",
          "optional",
          "pass",
          `CLI and provider settings are available (model=${ollamaOptions.model}); service and model availability were not checked.`
        )
      : result(
          "ollama",
          "Ollama",
          "optional",
          "warn",
          !ollamaPath
            ? "CLI not available; local model features are disabled."
            : "Provider model or endpoint is not configured; local semantic parsing is disabled.",
          !ollamaPath
            ? "Install Ollama if you want local rewriting or semantic job parsing."
            : "Configure jobParser.providers.ollama.model and url."
        )
  );

  const geminiCredentialSource = env.GEMINI_API_KEY
    ? "GEMINI_API_KEY environment variable"
    : config?.llm?.gemini?.apiKey?.trim()
    ? "cv-tailor.config.json"
    : null;
  checks.push(
    geminiCredentialSource
      ? result(
          "gemini",
          "Gemini",
          "optional",
          "pass",
          `Gemini API key is configured via ${geminiCredentialSource}; its value was not read or displayed.`
        )
      : result(
          "gemini",
          "Gemini",
          "optional",
          "warn",
          "No Gemini API key is configured.",
          "Set GEMINI_API_KEY or configure llm.gemini.apiKey only if you explicitly choose Gemini."
        )
  );

  const provider =
    env.JOB_PARSER_PROVIDER ?? config?.jobParser?.semanticProvider ?? "none";
  const providerSupported = ["none", "ollama", "gemini"].includes(provider);
  checks.push(
    providerSupported
      ? result(
          "job-parser-provider",
          "Job parser privacy",
          "required",
          "pass",
          provider === "none"
            ? "Semantic parsing is disabled; no job description is sent to a model."
            : `Semantic provider ${provider} was explicitly selected.`
        )
      : result(
          "job-parser-provider",
          "Job parser privacy",
          "required",
          "fail",
          `Unsupported JOB_PARSER_PROVIDER value: ${provider}.`,
          "Choose none, ollama, or gemini."
        )
  );

  const status = checks.some((check) => check.status === "fail")
    ? "blocked"
    : checks.some((check) => check.status === "warn")
      ? "ready-with-warnings"
      : "ready";
  return { status, checks };
}

export function diagnosticExitCode(status) {
  if (status === "blocked") return 1;
  if (status === "ready-with-warnings") return 2;
  return 0;
}
