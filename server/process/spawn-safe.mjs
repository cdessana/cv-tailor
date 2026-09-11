import { spawn } from "node:child_process";

/**
 * Safely executes a command using child_process.spawn with shell: false.
 * Prevents shell injection and allows streaming of stdout/stderr.
 *
 * @param {string} command Executable binary or path
 * @param {string[]} args Array of validated arguments
 * @param {object} options Execution options
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
export function spawnSafe(command, args = [], options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    onStdout,
    onStderr,
    timeout = 300000, // 5 min default timeout
  } = options;

  if (typeof command !== "string" || !command.trim()) {
    throw new Error("spawnSafe: command must be a non-empty string");
  }

  if (!Array.isArray(args)) {
    throw new Error("spawnSafe: args must be an array");
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 3000);
      reject(new Error(`Command timed out after ${timeout}ms: ${command} ${args.join(" ")}`));
    }, timeout);

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (typeof onStdout === "function") {
        onStdout(text);
      }
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (typeof onStderr === "function") {
        onStderr(text);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (!timedOut) {
        reject(new Error(`Failed to start process ${command}: ${error.message}`));
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const err = new Error(`${command} exited with code ${code}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}
