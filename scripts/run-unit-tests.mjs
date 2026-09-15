import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const testDirectories = ["test", "tests"];
const integrationTest = "evidence-builder-http.test.mjs";

const files = (await Promise.all(testDirectories.map(async (directory) => {
  const entries = await readdir(directory);
  return entries
    .filter((entry) => entry.endsWith(".test.mjs") && entry !== integrationTest)
    .map((entry) => `${directory}/${entry}`);
}))).flat().sort();

const child = spawn(process.execPath, ["--test", ...files], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
