import { Router } from "express";
import {
  getEvidenceSummary,
  getEvidenceCatalog,
  submitToReviewQueue,
  loadReviewQueue,
  rejectQueueItem,
  loadEvidence,
} from "../services/evidence-service.mjs";
import {
  answerEvidenceQuestionnaire,
  buildEvidence,
  evidenceBuilderStatus,
  promoteEvidenceCandidate,
  reviewEvidenceCandidate,
  migrateQueueItemToBuilder,
} from "../services/evidence-builder-service.mjs";

const router = Router();

// Candidate evidence is deliberately stored outside evidence.json until reviewed.
router.get("/builder", async (req, res, next) => {
  try { res.json(await evidenceBuilderStatus()); } catch (err) { next(err); }
});

router.get("/builder/candidate", async (req, res, next) => {
  try { const status = await evidenceBuilderStatus(); if (!status.candidate) return res.status(404).json({ error: "Evidence candidate not found." }); res.setHeader("Content-Disposition", 'attachment; filename="evidence-candidate.json"'); res.json(status.candidate); }
  catch (err) { next(err); }
});

router.get("/builder/report", async (req, res, next) => {
  try { const status = await evidenceBuilderStatus(); if (!status.report) return res.status(404).json({ error: "Evidence report not found." }); res.setHeader("Content-Disposition", 'attachment; filename="evidence-report.json"'); res.json(status.report); }
  catch (err) { next(err); }
});

router.post("/builder", async (req, res) => {
  try { res.status(201).json(await buildEvidence(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message, code: err.code, details: err.details }); }
});

router.post("/builder/questionnaire", async (req, res) => {
  try { res.json(await answerEvidenceQuestionnaire(req.body?.answers, { expectedRevision: req.body?.expectedRevision })); }
  catch (err) { res.status(err.code === "EVIDENCE_REVISION_CONFLICT" ? 409 : 400).json({ error: err.message, code: err.code, details: err.details }); }
});

router.post("/builder/from-queue/:id", async (req, res) => {
  try { res.status(201).json(await migrateQueueItemToBuilder(req.params.id)); }
  catch (err) { res.status(400).json({ error: err.message, code: err.code }); }
});

router.post("/builder/review", async (req, res) => {
  try { res.json(await reviewEvidenceCandidate(req.body?.decisions, { expectedRevision: req.body?.expectedRevision })); }
  catch (err) { res.status(err.code === "EVIDENCE_REVISION_CONFLICT" ? 409 : 400).json({ error: err.message, code: err.code, details: err.details }); }
});

router.post("/builder/promote", async (req, res) => {
  try { res.json(await promoteEvidenceCandidate({ expectedRevision: req.body?.expectedRevision })); }
  catch (err) { res.status(["EVIDENCE_PROMOTION_BLOCKED", "EVIDENCE_REVISION_CONFLICT"].includes(err.code) ? 409 : 400).json({ error: err.message, code: err.code, details: err.details }); }
});

// Evidence base overview metrics
router.get("/summary", async (req, res, next) => {
  try {
    const summary = await getEvidenceSummary();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Filterable Evidence Catalog
router.get("/catalog", async (req, res, next) => {
  try {
    const { q, skill, company, type } = req.query;
    const catalog = await getEvidenceCatalog({
      query: q,
      skill,
      company,
      type,
    });
    res.json(catalog);
  } catch (err) {
    next(err);
  }
});

// New facts must enter review before they can become canonical evidence.
router.post("/experiences", async (req, res) => {
  res.status(410).json({ error: "Direct writes to canonical evidence are disabled. Submit the claim to the review queue or Evidence Builder.", code: "EVIDENCE_DIRECT_WRITE_DISABLED" });
});

// Canonical evidence is immutable outside builder promotion.
router.put("/experiences/:id", async (req, res) => {
  res.status(410).json({ error: "Canonical evidence is immutable outside Evidence Builder promotion.", code: "EVIDENCE_DIRECT_WRITE_DISABLED" });
});

// Delete experience
router.delete("/experiences/:id", async (req, res) => {
  res.status(410).json({ error: "Canonical evidence is immutable outside Evidence Builder promotion.", code: "EVIDENCE_DIRECT_WRITE_DISABLED" });
});

// Review queue listing
router.get("/queue", async (req, res, next) => {
  try {
    const queue = await loadReviewQueue();
    res.json(queue);
  } catch (err) {
    next(err);
  }
});

// Submit facts to Review Queue (from Interview or manual input)
router.post("/queue", async (req, res) => {
  try {
    const item = await submitToReviewQueue(req.body);
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Approve review queue item
router.post("/queue/:id/approve", async (req, res) => {
  res.status(410).json({ error: "Legacy queue approval is disabled. Review and promote through Evidence Builder.", code: "EVIDENCE_DIRECT_WRITE_DISABLED" });
});

// Reject review queue item
router.post("/queue/:id/reject", async (req, res) => {
  try {
    const result = await rejectQueueItem(req.params.id, req.body?.reason || "");
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Export full evidence JSON
router.get("/export", async (req, res, next) => {
  try {
    const data = await loadEvidence();
    res.setHeader("Content-Disposition", 'attachment; filename="evidence.json"');
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    next(err);
  }
});

// Import full evidence JSON
router.post("/import", async (req, res) => {
  res.status(410).json({ error: "Direct canonical imports are disabled. Build and review a candidate before promotion.", code: "EVIDENCE_DIRECT_WRITE_DISABLED" });
});

export default router;
