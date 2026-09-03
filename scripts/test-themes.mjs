import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const resumePath =
  process.argv[2] ||
  "output/flash/resume-final.json";

const themes =
  process.argv.slice(3);

if (!themes.length) {
  console.error(
    "Usage: node scripts/test-themes.mjs <resume.json> <theme1> [theme2] ..."
  );
  process.exit(1);
}

const outputDir =
  path.join(
    path.dirname(resumePath),
    "themes"
  );

await fs.mkdir(
  outputDir,
  { recursive: true }
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child =
      spawn(
        command,
        args,
        {
          stdio: "inherit",
          shell: false
        }
      );

    child.on("error", reject);

    child.on("exit", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} exited with code ${code}`
          )
        );
      }
    });
  });
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child =
      spawn(
        command,
        args,
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe"
          ],
          shell: false
        }
      );

    let stdout = "";
    let stderr = "";

    child.stdout.on(
      "data",
      chunk =>
        stdout += chunk
    );

    child.stderr.on(
      "data",
      chunk =>
        stderr += chunk
    );

    child.on("error", reject);

    child.on("exit", code => {
      if (code === 0) {
        resolve({
          stdout,
          stderr
        });
      } else {
        reject(
          new Error(
            `${command} exited with code ${code}\n${stderr}`
          )
        );
      }
    });
  });
}

const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const results = [];

for (const theme of themes) {
  const shortName =
  theme
    .replace(/^@/, "")
    .replace(/\//g, "-")
    .replace(/jsonresume-theme-/g, "");

  const htmlPath =
    path.join(
      outputDir,
      `${shortName}.html`
    );

  const pdfPath =
    path.join(
      outputDir,
      `${shortName}.pdf`
    );

  const txtPath =
    path.join(
      outputDir,
      `${shortName}.txt`
    );

  console.log(
    `\n==============================`
  );

  console.log(
    `Testing theme: ${theme}`
  );

  console.log(
    `==============================`
  );

  await run(
    "npx",
    [
      "resumed",
      "render",
      resumePath,
      "--theme",
      theme,
      "--output",
      htmlPath
    ]
  );

  await run(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file://${path.resolve(htmlPath)}`
    ]
  );

  await run(
    "pdftotext",
    [
      pdfPath,
      txtPath
    ]
  );

  const pdfInfo =
    await runCapture(
      "pdfinfo",
      [pdfPath]
    );

  const pagesMatch =
    pdfInfo.stdout.match(
      /^Pages:\s+(\d+)/m
    );

  const pages =
    pagesMatch
      ? Number(pagesMatch[1])
      : null;

  const html =
    await fs.readFile(
      htmlPath,
      "utf8"
    );

  const text =
    await fs.readFile(
      txtPath,
      "utf8"
    );

  const checks = {
    correctCurrentDate:
      html.includes("Mar 2024"),

    grpcAnywhere:
      text.includes("gRPC"),

    grpcInSkills:
      /Backend Engineering[\s\S]{0,500}gRPC/i.test(
        text
      ),

    cleanArchitecture:
      text.includes(
        "Clean Architecture"
      ),

    node:
      text.includes(
        "Node.js"
      ),

    mongodb:
      text.includes(
        "MongoDB"
      ),

    domainDrivenDesign:
      /Domain[--]Driven Design/i.test(
        text
      )
  };

  results.push({
    theme,
    pages,
    ...checks
  });

  console.log(
    `Pages: ${pages ?? "unknown"}`
  );

  console.log(
    `Date: ${checks.correctCurrentDate ? "✓" : "✗"}`
  );

  console.log(
    `gRPC: ${checks.grpcAnywhere ? "✓" : "✗"}`
  );

  console.log(
    `gRPC in Skills: ${checks.grpcInSkills ? "✓" : "✗"}`
  );

  console.log(
    `Clean Architecture: ${checks.cleanArchitecture ? "✓" : "✗"}`
  );
}

const lines = [
  "THEME COMPARISON",
  "================",
  ""
];

for (const result of results) {
  lines.push(
    result.theme
  );

  lines.push(
    `  Pages: ${result.pages ?? "unknown"}`
  );

  lines.push(
    `  Correct dates: ${result.correctCurrentDate ? "yes" : "no"}`
  );

  lines.push(
    `  gRPC present: ${result.grpcAnywhere ? "yes" : "no"}`
  );

  lines.push(
    `  gRPC in skills: ${result.grpcInSkills ? "yes" : "no"}`
  );

  lines.push(
    `  Clean Architecture: ${result.cleanArchitecture ? "yes" : "no"}`
  );

  lines.push(
    `  Node.js: ${result.node ? "yes" : "no"}`
  );

  lines.push(
    `  MongoDB: ${result.mongodb ? "yes" : "no"}`
  );

  lines.push(
    `  Domain-Driven Design: ${result.domainDrivenDesign ? "yes" : "no"}`
  );

  lines.push("");
}

const reportPath =
  path.join(
    outputDir,
    "theme-report.txt"
  );

await fs.writeFile(
  reportPath,
  lines.join("\n")
);

console.log(
  `\nReport: ${reportPath}`
);
