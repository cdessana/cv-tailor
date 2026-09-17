import { Router } from "express";
import { createLinkedInImport, createLinkedInPdfImport, linkedInImportHistory, linkedInImportStatus, promoteLinkedInImport } from "../services/linkedin-import-service.mjs";
const router = Router();
router.get("/", async (_req, res, next) => { try { res.json(await linkedInImportStatus()); } catch (error) { next(error); } });
router.get("/history", async (_req, res, next) => { try { res.json(await linkedInImportHistory()); } catch (error) { next(error); } });
router.post("/", async (req, res) => { try { res.status(201).json(await createLinkedInImport(req.body?.source)); } catch (error) { res.status(400).json({ error: error.message, code: error.code, details: error.details }); } });
router.post("/pdf", async (req, res) => { try { res.status(201).json(await createLinkedInPdfImport(req.body?.pdfBase64, req.body?.profileUrl)); } catch (error) { res.status(400).json({ error: error.message, code: error.code, details: error.details }); } });
router.post("/promote", async (req, res) => { try { res.json(await promoteLinkedInImport(req.body?.decisions)); } catch (error) { res.status(error.code === "LINKEDIN_REVIEW_REQUIRED" ? 409 : 400).json({ error: error.message, code: error.code, details: error.details }); } });
export default router;
