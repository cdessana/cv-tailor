import { Router } from "express";
import {
  getEvidenceSummary,
  getEvidenceCatalog,
  addExperience,
  updateExperience,
  deleteExperience,
  submitToReviewQueue,
  loadReviewQueue,
  approveQueueItem,
  rejectQueueItem,
  loadEvidence,
  saveEvidence,
} from "../services/evidence-service.mjs";

const router = Router();

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

// Add experience directly
router.post("/experiences", async (req, res) => {
  try {
    const created = await addExperience(req.body);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update experience directly
router.put("/experiences/:id", async (req, res) => {
  try {
    const updated = await updateExperience(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete experience
router.delete("/experiences/:id", async (req, res) => {
  try {
    const result = await deleteExperience(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
  try {
    const result = await approveQueueItem(req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
  try {
    const data = req.body;
    await saveEvidence(data);
    const summary = await getEvidenceSummary();
    res.json({ success: true, summary });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
