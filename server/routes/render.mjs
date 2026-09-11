import { Router } from "express";
import {
  renderResume,
  SUPPORTED_THEMES,
} from "../services/render-service.mjs";

const router = Router();

router.get("/themes", (req, res) => {
  res.json({ themes: SUPPORTED_THEMES });
});

router.post("/", async (req, res) => {
  const { resumePath, theme, outputDir } = req.body || {};

  if (!resumePath) {
    return res.status(400).json({ error: "resumePath is required." });
  }

  try {
    const result = await renderResume({ resumePath, theme, outputDir });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
