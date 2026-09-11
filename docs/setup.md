# Local setup and troubleshooting

Run the readiness diagnostic after `npm install` and whenever the local
environment changes:

```sh
npm run doctor
npm run doctor -- --json
```

The command checks only the runtime environment and validated configuration. It
does not read résumé or job-description files, call Gemini or Ollama, validate a
remote credential, or print secret values.

## Status and exit codes

- `READY` (`0`): all required and optional capabilities are available.
- `BLOCKED` (`1`): a required runtime, dependency, browser, Poppler command, or
  configuration check failed.
- `READY-WITH-WARNINGS` (`2`): required capabilities are ready, but Gemini or
  Ollama is unavailable. These features remain optional.

Each failed or missing check includes a corrective action. In automation, use
the JSON output and inspect each check's `category` (`required` or `optional`)
and `status` (`pass`, `warn`, or `fail`).

## Required capabilities

- Node.js 22 or newer and npm.
- Packages installed with `npm install`.
- A Chrome/Chromium executable. Puppeteer's managed browser is detected
  automatically.
- Poppler commands `pdftotext` and `pdfinfo` on `PATH`.
- A valid `cv-tailor.config.json`, or a valid file selected through
  `CV_TAILOR_CONFIG`.

Configure a custom browser portably with either:

```json
{
  "render": {
    "browserExecutable": "/path/to/chrome-or-chromium"
  }
}
```

or `PUPPETEER_EXECUTABLE_PATH`. The environment variable takes precedence over
the configuration value. No standard macOS application path is assumed.

## Optional providers and privacy

The job parser defaults to `none`. Deterministic extraction still runs, but it
fails safely when semantic interpretation is required. Select `ollama` or
`gemini` explicitly through the documented CLI, environment, or configuration
precedence to enable semantic parsing.

The Ollama diagnostic checks whether the local CLI, endpoint setting, and model
setting exist. Service and model availability are reported as `not-checked`;
the command does not contact the configured endpoint or verify that its daemon
is running or that the model is installed. The Gemini diagnostic checks only
whether `GEMINI_API_KEY` is present; it never reads or displays the value.
Consequently, a passing provider check confirms local configuration, not remote
credentials or model availability.

## Rendering options

The renderer writes beside its JSON input by default and continues to accept a
theme as its second positional argument:

```sh
node scripts/render.mjs output/example/resume-final.json
node scripts/render.mjs output/example/resume-final.json jsonresume-theme-stackoverflow
```

Select another output location with `--output-dir`:

```sh
node scripts/render.mjs data/resumes/base.json --output-dir output
```

Browser selection uses `PUPPETEER_EXECUTABLE_PATH`, then
`render.browserExecutable`, then Puppeteer's managed browser. An explicit path
must identify an executable file; invalid overrides fail with an actionable
message instead of silently falling back.

## Common failures

- **Missing npm dependencies:** run `npm install` in the project root.
- **Browser not found:** reinstall Puppeteer's browser or set a valid custom
  executable path.
- **Poppler missing:** install `poppler` on macOS, `poppler-utils` on
  Debian/Ubuntu, or the equivalent package for your platform.
- **Invalid configuration:** follow the field-specific validation message and
  rerun the diagnostic.
- **Configured path unavailable:** create the required input parent directory,
  or correct permissions on the jobs/output directory or its nearest existing
  parent. The diagnostic checks filesystem readiness without opening résumé
  files.
- **Ollama unavailable:** install Ollama and pull the configured model only if
  local model features are desired.
- **Gemini unavailable:** set `GEMINI_API_KEY` only after explicitly choosing
  cloud semantic parsing.
