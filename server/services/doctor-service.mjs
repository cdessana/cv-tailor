import { runDoctor } from "../../scripts/doctor.mjs";

/**
 * Execute system diagnostics using existing scripts/doctor.mjs
 * Returns structured status, checks, counts, and recommendations.
 */
export async function getEnvironmentDiagnostics() {
  const silentLogger = {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
  };

  try {
    const report = await runDoctor({ json: true, logger: silentLogger });
    return {
      status: report.status, // "pass" | "warn" | "fail" | "blocked"
      summary: {
        ready: report.status === "pass" || report.status === "ready",
        warnings: report.checks.filter((c) => c.status === "warn").length,
        failures: report.checks.filter((c) => c.status === "fail").length,
        passed: report.checks.filter((c) => c.status === "pass").length,
      },
      checks: report.checks.map((c) => ({
        id: c.id,
        label: c.label,
        status: c.status,
        category: c.category,
        message: c.message,
        action: c.action || null,
      })),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "error",
      error: error.message,
      summary: { ready: false, warnings: 0, failures: 1, passed: 0 },
      checks: [
        {
          id: "diagnostic_execution",
          label: "Doctor Diagnostic",
          status: "fail",
          category: "required",
          message: `Diagnostic execution failed: ${error.message}`,
          action: "Check Node runtime and permissions",
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }
}
