import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const resumePath = process.argv[2];

if (!resumePath) {
  console.error(
    "Usage: node scripts/render-stackoverflow.mjs <resume-final.json>"
  );
  process.exit(1);
}

const outputDir = path.dirname(resumePath);

const htmlPath =
  path.join(outputDir, "resume.html");

const pdfPath =
  path.join(outputDir, "resume.pdf");

const txtPath =
  path.join(outputDir, "resume.txt");

const tempResumePath =
  path.join(outputDir, ".resume-render.json");

const rawHtmlPath =
  path.join(outputDir, ".resume-render.html");

const chrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child =
      spawn(
        command,
        args,
        {
          shell: false,
          stdio:
            options.quiet
              ? ["ignore", "pipe", "pipe"]
              : "inherit"
        }
      );

    let stdout = "";
    let stderr = "";

    if (options.quiet) {
      child.stdout?.on(
        "data",
        chunk => {
          stdout += chunk;
        }
      );

      child.stderr?.on(
        "data",
        chunk => {
          stderr += chunk;
        }
      );
    }

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
            `${command} exited with code ${code}` +
            (
              stderr
                ? `\n${stderr}`
                : ""
            )
          )
        );
      }
    });
  });
}

function monthName(month) {
  return [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sept",
    "Oct",
    "Nov",
    "Dec"
  ][Number(month) - 1];
}

/*
 * jsonresume-theme-stackoverflow parses date-only
 * strings using JavaScript Date semantics.
 *
 * On negative UTC offsets, YYYY-MM can become
 * the previous month.
 *
 * Rendering with the 15th keeps us safely inside
 * the intended month without modifying the real
 * resume.
 */
function safeRenderDate(value) {
  if (
    typeof value !== "string"
  ) {
    return value;
  }

  if (
    /^\d{4}-\d{2}$/.test(value)
  ) {
    return `${value}-15`;
  }

  if (
    /^\d{4}$/.test(value)
  ) {
    return `${value}-07-15`;
  }

  return value;
}

function transformDates(value) {
  if (
    Array.isArray(value)
  ) {
    return value.map(
      transformDates
    );
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const result = {};

    for (
      const [key, child] of
      Object.entries(value)
    ) {
      if (
        [
          "startDate",
          "endDate",
          "date",
          "releaseDate"
        ].includes(key)
      ) {
        result[key] =
          safeRenderDate(child);
      } else {
        result[key] =
          transformDates(child);
      }
    }

    return result;
  }

  return value;
}

function collectYearOnlyDates(value, found = new Set()) {
  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      collectYearOnlyDates(
        item,
        found
      );
    }

    return found;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    for (
      const [key, child] of
      Object.entries(value)
    ) {
      if (
        [
          "startDate",
          "endDate",
          "date",
          "releaseDate"
        ].includes(key) &&
        typeof child === "string" &&
        /^\d{4}$/.test(child)
      ) {
        found.add(child);
      }

      collectYearOnlyDates(
        child,
        found
      );
    }
  }

  return found;
}

function expectedMonthDates(value, found = []) {
  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      expectedMonthDates(
        item,
        found
      );
    }

    return found;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    for (
      const [key, child] of
      Object.entries(value)
    ) {
      if (
        [
          "startDate",
          "endDate",
          "date",
          "releaseDate"
        ].includes(key) &&
        typeof child === "string"
      ) {
        const match =
          child.match(
            /^(\d{4})-(\d{2})$/
          );

        if (match) {
          found.push({
            source: child,
            rendered:
              `${monthName(match[2])} ${match[1]}`
          });
        }
      }

      expectedMonthDates(
        child,
        found
      );
    }
  }

  return found;
}

function escapeRegExp(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function normalizeWhitespace(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

const resume =
  JSON.parse(
    await fs.readFile(
      resumePath,
      "utf8"
    )
  );

console.log(
  "\nSTACKOVERFLOW RENDER"
);

console.log(
  "===================="
);

console.log(
  `Source: ${resumePath}`
);

/*
 * Validate the original JSON, never the
 * temporary rendering copy.
 */
console.log(
  "\n▶ JSON Resume schema validation"
);

await run(
  "npx",
  [
    "resumed",
    "validate",
    resumePath
  ]
);

console.log(
  "✓ Schema validation passed"
);

const renderResume =
  transformDates(
    structuredClone(resume)
  );

await fs.writeFile(
  tempResumePath,
  JSON.stringify(
    renderResume,
    null,
    2
  ) + "\n"
);

console.log(
  "\n▶ Rendering StackOverflow theme"
);

await run(
  "npx",
  [
    "resumed",
    "render",
    tempResumePath,
    "--theme",
    "jsonresume-theme-stackoverflow",
    "--output",
    rawHtmlPath
  ]
);

let html =
  await fs.readFile(
    rawHtmlPath,
    "utf8"
  );

/*
 * Dates that originally contained only a year
 * were temporarily rendered as Jul YYYY.
 * Restore their original precision.
 */
const yearOnlyDates =
  collectYearOnlyDates(
    resume
  );

for (
  const year of yearOnlyDates
) {
  html =
    html.replace(
      new RegExp(
        escapeRegExp(
          `Jul ${year}`
        ),
        "g"
      ),
      year
    );
}

await fs.writeFile(
  htmlPath,
  html,
  "utf8"
);

console.log(
  `✓ HTML: ${htmlPath}`
);

/*
 * Check the date bug before creating the PDF.
 */
const expectedDates =
  expectedMonthDates(
    resume
  );

const missingDates =
  expectedDates.filter(
    item =>
      !html.includes(
        item.rendered
      )
  );

if (
  missingDates.length
) {
  console.error(
    "\n✗ Rendered HTML is missing expected dates:"
  );

  for (
    const item of missingDates
  ) {
    console.error(
      `  ${item.source} → ${item.rendered}`
    );
  }

  throw new Error(
    "Date sanity check failed."
  );
}

console.log(
  "✓ Date sanity check passed"
);

console.log(
  "\n▶ Generating PDF"
);

await run(
  chrome,
  [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${path.resolve(pdfPath)}`,
    `file://${path.resolve(htmlPath)}`
  ],
  {
    quiet: true
  }
);

console.log(
  `✓ PDF: ${pdfPath}`
);

console.log(
  "\n▶ Extracting PDF text"
);

await run(
  "pdftotext",
  [
    pdfPath,
    txtPath
  ]
);

console.log(
  `✓ Text: ${txtPath}`
);

const pdfInfo =
  await run(
    "pdfinfo",
    [pdfPath],
    {
      quiet: true
    }
  );

const pagesMatch =
  pdfInfo.stdout.match(
    /^Pages:\s+(\d+)/m
  );

const pages =
  pagesMatch
    ? Number(pagesMatch[1])
    : null;

const text =
  await fs.readFile(
    txtPath,
    "utf8"
  );

const normalizedText =
  normalizeWhitespace(
    text
  );

const checks = [
  {
    name: "Name",
    expected:
      resume.basics?.name
  },
  {
    name: "Email",
    expected:
      resume.basics?.email
  },
  {
    name: "Phone",
    expected:
      resume.basics?.phone
  },
  {
    name: "Node.js",
    expected: "Node.js"
  },
  {
    name: "MongoDB",
    expected: "MongoDB"
  },
  {
    name: "gRPC",
    expected: "gRPC"
  },
  {
    name: "Domain-Driven Design",
    expected:
      "Domain-Driven Design"
  }
].filter(
  check =>
    check.expected
);

const failedChecks =
  checks.filter(
    check =>
      !normalizedText.includes(
        check.expected
      )
  );

console.log(
  "\nPDF SANITY CHECK"
);

console.log(
  "================"
);

console.log(
  `Pages: ${pages ?? "unknown"}`
);

for (
  const check of checks
) {
  const passed =
    !failedChecks.includes(
      check
    );

  console.log(
    `${passed ? "✓" : "✗"} ${check.name}`
  );
}

for (
  const item of
  expectedDates
) {
  const passed =
    normalizedText.includes(
      item.rendered
    );

  console.log(
    `${passed ? "✓" : "✗"} Date ${item.source} → ${item.rendered}`
  );

  if (!passed) {
    failedChecks.push({
      name:
        `Date ${item.source}`,
      expected:
        item.rendered
    });
  }
}

if (
  pages &&
  pages > 2
) {
  console.warn(
    `\n! PDF has ${pages} pages; target is 2.`
  );
}

if (
  failedChecks.length
) {
  console.error(
    `\n✗ PDF sanity check failed (${failedChecks.length} issue(s)).`
  );

  process.exitCode = 1;
} else {
  console.log(
    "\n✓ PDF sanity check passed"
  );
}

/*
 * Temporary files should never become
 * project artifacts.
 */
await Promise.allSettled([
  fs.unlink(
    tempResumePath
  ),
  fs.unlink(
    rawHtmlPath
  )
]);

console.log(
  "\nGenerated:"
);

console.log(
  `  ${htmlPath}`
);

console.log(
  `  ${pdfPath}`
);

console.log(
  `  ${txtPath}`
);
