import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import puppeteer from "puppeteer";
import { createApp } from "../server/app.mjs";

const resume = {
  basics: { name: "HTTP Candidate", email: "candidate@example.com" },
  skills: [{ name: "Backend", keywords: ["Node.js", "PostgreSQL"] }],
  work: [{ name: "Example", position: "Engineer", startDate: "2021", endDate: "2023", highlights: ["Built REST APIs using Node.js and PostgreSQL."] }],
};

function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    ...(process.env.CI === "true" ? { args: ["--no-sandbox", "--disable-setuid-sandbox"] } : {}),
  });
}

async function startTestServer(testResume = resume) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-builder-http-"));
  const configPath = path.join(root, "config.json");
  await fs.writeFile(path.join(root, "base.json"), JSON.stringify(testResume));
  await fs.writeFile(configPath, JSON.stringify({ paths: {
    baseResume: path.join(root, "base.json"), evidence: path.join(root, "evidence.json"), aliases: path.join(root, "aliases.json"), jobs: path.join(root, "jobs"), output: path.join(root, "output"),
  } }));
  const previousConfig = process.env.CV_TAILOR_CONFIG;
  process.env.CV_TAILOR_CONFIG = configPath;
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return {
    root,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousConfig === undefined) delete process.env.CV_TAILOR_CONFIG;
      else process.env.CV_TAILOR_CONFIG = previousConfig;
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function request(url, pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

test("Evidence Builder HTTP workflow validates, reviews, and promotes through the API", async () => {
  const server = await startTestServer();
  try {
    const invalid = await request(server.url, "/api/evidence/builder", { method: "POST", body: JSON.stringify({ resume: { basics: { email: "invalid" } } }) });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.code, "EVIDENCE_RESUME_INVALID");

    const built = await request(server.url, "/api/evidence/builder", { method: "POST", body: JSON.stringify({ resume, sourceReference: "fixture.json" }) });
    assert.equal(built.response.status, 201);
    assert.equal(built.body.report.status, "review_required");
    assert.ok(built.body.candidate.claims[0].id);

    const question = built.body.candidate.questionnaire.questions.find((item) => item.key === "quality");
    const answered = await request(server.url, "/api/evidence/builder/questionnaire", { method: "POST", body: JSON.stringify({ expectedRevision: built.body.candidate.revision, answers: [{ questionId: question.id, answer: "Wrote unit tests." }] }) });
    assert.equal(answered.response.status, 200);
    assert.equal(answered.body.candidate.claims.some((claim) => claim.source.type === "questionnaire"), true);

    const blocked = await request(server.url, "/api/evidence/builder/promote", { method: "POST", body: JSON.stringify({ expectedRevision: answered.body.candidate.revision }) });
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.body.code, "EVIDENCE_PROMOTION_BLOCKED");

    const staleReview = await request(server.url, "/api/evidence/builder/review", { method: "POST", body: JSON.stringify({ expectedRevision: built.body.candidate.revision, decisions: [{ claimId: built.body.candidate.claims[0].id, status: "approved" }] }) });
    assert.equal(staleReview.response.status, 409);
    assert.equal(staleReview.body.code, "EVIDENCE_REVISION_CONFLICT");

    const rejectedDecision = await request(server.url, "/api/evidence/builder/review", { method: "POST", body: JSON.stringify({ expectedRevision: answered.body.candidate.revision, decisions: [{ claimId: "claim_unknown", status: "approved" }] }) });
    assert.equal(rejectedDecision.response.status, 400);
    assert.equal(rejectedDecision.body.code, "EVIDENCE_CLAIM_UNKNOWN");

    const reviewed = await request(server.url, "/api/evidence/builder/review", { method: "POST", body: JSON.stringify({ expectedRevision: answered.body.candidate.revision, decisions: answered.body.candidate.claims.map((claim) => ({ claimId: claim.id, status: "approved" })) }) });
    assert.equal(reviewed.response.status, 200);
    assert.equal(reviewed.body.report.promotionSafe, true);

    const promoted = await request(server.url, "/api/evidence/builder/promote", { method: "POST", body: JSON.stringify({ expectedRevision: reviewed.body.candidate.revision }) });
    assert.equal(promoted.response.status, 200);
    assert.equal(promoted.body.evidence.experiences.length, 1);
    const canonical = JSON.parse(await fs.readFile(path.join(server.root, "evidence.json"), "utf8"));
    assert.deepEqual(canonical, promoted.body.evidence);
  } finally {
    await server.close();
  }
});

test("web client assets expose the Evidence Builder review contract", async () => {
  const server = await startTestServer();
  try {
    const [appResponse, apiResponse] = await Promise.all([
      fetch(`${server.url}/app.js`),
      fetch(`${server.url}/evidence-builder-api.js`),
    ]);
    assert.equal(appResponse.status, 200);
    assert.equal(apiResponse.status, 200);
    const [appScript, apiScript] = await Promise.all([appResponse.text(), apiResponse.text()]);
    for (const endpoint of ["/api/evidence/builder", "/api/evidence/builder/questionnaire", "/api/evidence/builder/review", "/api/evidence/builder/promote"]) {
      assert.equal(apiScript.includes(endpoint), true, `missing client endpoint ${endpoint}`);
    }
    assert.equal(appScript.includes('import { evidenceBuilderApi }'), true);
    assert.equal(appScript.includes("/api/evidence/experiences/"), false);
    assert.equal(appScript.includes("data-project-question"), true);
    assert.equal(appScript.includes("btn-promote-evidence"), true);
  } finally {
    await server.close();
  }
});

test("web UI can review and promote a candidate evidence claim", async () => {
  const server = await startTestServer();
  let browser;
  try {
    const built = await request(server.url, "/api/evidence/builder", { method: "POST", body: JSON.stringify({ resume, sourceReference: "fixture.json" }) });
    assert.equal(built.response.status, 201);
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 10_000 });
    await page.click("#nav-evidence");
    await page.waitForSelector("#evidence-builder-container:not(.hidden)", { timeout: 10_000 });
    assert.equal(await page.$eval("#evidence-builder-container", (element) => element.textContent.includes("Evidence Builder Review")), true);
    await page.click(".btn-review-claim[data-status='approved']");
    await page.waitForSelector("#btn-promote-evidence:not([disabled])", { timeout: 10_000 });
    await page.click("#btn-promote-evidence");
    await page.waitForFunction("document.body.textContent.includes('Approved evidence promoted to the canonical base.')", { timeout: 10_000 });
    const canonical = JSON.parse(await fs.readFile(path.join(server.root, "evidence.json"), "utf8"));
    assert.equal(canonical.experiences[0].facts[0], resume.work[0].highlights[0]);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("web UI resolves a source conflict and reviews every affected claim", async () => {
  const server = await startTestServer();
  let browser;
  try {
    const initial = await request(server.url, "/api/evidence/builder", { method: "POST", body: JSON.stringify({ resume, sourceReference: "fixture.json" }) });
    const originalClaim = initial.body.candidate.claims[0];
    const built = await request(server.url, "/api/evidence/builder", {
      method: "POST",
      body: JSON.stringify({
        resume,
        sourceReference: "fixture.json",
        supportingSources: [{ type: "feedback", reference: "feedback:manager", claims: [{ contextId: originalClaim.contextId, claim: "Built only GraphQL APIs.", conflictsWith: [originalClaim.id] }] }],
      }),
    });
    assert.equal(built.response.status, 201);

    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 10_000 });
    await page.click("#nav-evidence");
    await page.waitForSelector(".btn-resolve-issue", { timeout: 10_000 });
    await page.select("select[data-issue-value]", "Built only GraphQL APIs.");
    await page.click(".btn-resolve-issue");
    await page.waitForSelector("#btn-promote-evidence:not([disabled])", { timeout: 10_000 });
    const candidate = await (await fetch(`${server.url}/api/evidence/builder/candidate`)).json();
    assert.equal(candidate.claims.find((claim) => claim.claim === "Built only GraphQL APIs.").reviewStatus, "approved");
    assert.equal(candidate.claims.find((claim) => claim.id === originalClaim.id).reviewStatus, "rejected");
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("web UI does not submit questionnaire questions that are outside the visible page", async () => {
  const sparseResume = {
    basics: { name: "Sparse Candidate", email: "sparse@example.com" },
    work: [{ name: "Example", position: "Engineer" }],
  };
  const server = await startTestServer(sparseResume);
  let browser;
  try {
    const built = await request(server.url, "/api/evidence/builder", { method: "POST", body: JSON.stringify({ resume: sparseResume, sourceReference: "fixture.json" }) });
    assert.equal(built.body.candidate.questionnaire.questions.length, 9);

    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 10_000 });
    await page.click("#nav-evidence");
    await page.waitForSelector("#btn-submit-builder-answers", { timeout: 10_000 });
    await page.click("#btn-submit-builder-answers");
    await page.waitForFunction(async () => {
      const result = await (await fetch("/api/evidence/builder/candidate")).json();
      return result.questionnaire.questions.some((question) => question.answered);
    }, { timeout: 10_000 });

    const candidate = await (await fetch(`${server.url}/api/evidence/builder/candidate`)).json();
    const responsibilities = candidate.questionnaire.questions.find((question) => question.key === "responsibilities");
    assert.equal(responsibilities.answered, false);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("web UI builds from the configured resume and preserves source references", async () => {
  const server = await startTestServer();
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 10_000 });
    await page.click("#nav-evidence");
    await page.click("#btn-build-evidence");
    await page.waitForSelector("#modal-build-evidence:not(.hidden)");
    await page.click("#btn-add-evidence-source");
    await page.$eval("[data-source-type]", (element) => { element.value = "github"; });
    await page.type("[data-source-reference]", "github:example/project");
    await page.click("#btn-submit-build-evidence");
    await page.waitForSelector("#evidence-builder-container:not(.hidden)", { timeout: 10_000 });
    const candidate = await (await fetch(`${server.url}/api/evidence/builder/candidate`)).json();
    assert.deepEqual(candidate.supportingSources, [{ type: "github", reference: "github:example/project" }]);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("web UI uploads a structured resume JSON for validation", async () => {
  const server = await startTestServer();
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 10_000 });
    await page.click("#nav-evidence");
    await page.click("#btn-build-evidence");
    await page.click('input[name="evidence-resume-source"][value="file"]');
    const input = await page.$("#input-evidence-resume-file");
    await input.uploadFile(path.join(server.root, "base.json"));
    await page.click("#btn-submit-build-evidence");
    await page.waitForSelector("#evidence-builder-container:not(.hidden)", { timeout: 10_000 });
    const candidate = await (await fetch(`${server.url}/api/evidence/builder/candidate`)).json();
    assert.equal(candidate.source.reference, "base.json");
  } finally {
    await browser?.close();
    await server.close();
  }
});
