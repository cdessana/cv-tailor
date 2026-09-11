import { Router } from "express";
import { getSanitizedConfig, updateConfig } from "../services/config-service.mjs";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const config = await getSanitizedConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

router.put("/", async (req, res, next) => {
  try {
    const updated = await updateConfig(req.body);
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
