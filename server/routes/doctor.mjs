import { Router } from "express";
import { getEnvironmentDiagnostics } from "../services/doctor-service.mjs";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const report = await getEnvironmentDiagnostics();
    res.json(report);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const report = await getEnvironmentDiagnostics();
    res.json(report);
  } catch (err) {
    next(err);
  }
});

export default router;
