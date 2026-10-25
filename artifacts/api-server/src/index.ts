import app from "./app";
import { logger } from "./lib/logger";
import { spawn } from "node:child_process";
import path from "node:path";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const apiPort = Number(process.env.CHATMASTER_API_PORT ?? "18081");
if (Number.isNaN(apiPort) || apiPort <= 0) {
  throw new Error(`Invalid CHATMASTER_API_PORT value: "${process.env.CHATMASTER_API_PORT}"`);
}

const workspaceRoot = path.resolve(process.cwd(), "..", "..");
const python = path.join(workspaceRoot, ".pythonlibs", "bin", "python");
const fastapi = spawn(
  python,
  ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(apiPort)],
  {
    cwd: path.join(workspaceRoot, "artifacts", "api-server", "fastapi"),
    env: process.env,
    stdio: "inherit",
  },
);

fastapi.on("error", (err) => {
  logger.error({ err }, "Could not start the FastAPI service");
  process.exit(1);
});

async function waitForFastApi(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fastapi.exitCode !== null) {
      throw new Error(`FastAPI exited with code ${fastapi.exitCode}.`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/healthz`);
      if (response.ok) return;
    } catch {
      // Uvicorn is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("FastAPI did not become healthy within 20 seconds.");
}

void (async () => {
  try {
    await waitForFastApi();
    const server = app.listen(port, () => {
      logger.info({ port, apiPort }, "ChatMaster API gateway listening");
    });
    server.on("error", (err) => {
      logger.error({ err }, "Error listening on API gateway port");
      fastapi.kill("SIGTERM");
      process.exit(1);
    });
    const stop = () => {
      server.close();
      fastapi.kill("SIGTERM");
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch (err) {
    logger.error({ err }, "Unable to start ChatMaster services");
    fastapi.kill("SIGTERM");
    process.exit(1);
  }
})();
