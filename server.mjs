import { createApp } from "./server/app.mjs";

const PORT = 3000;
const HOST = "0.0.0.0";

const app = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`[CV Tailor] Server running on http://${HOST}:${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("[CV Tailor] SIGTERM received, shutting down gracefully");
  server.close(() => {
    process.exit(0);
  });
});
