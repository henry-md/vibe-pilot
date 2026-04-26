import { watch } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const appDir = process.cwd();
const sourceDir = path.join(appDir, "src");
const distDir = path.join(appDir, "dist");
const watchMode = process.argv.includes("--watch");
const hotReloadClients = new Set();

const webPort = normalizePort(process.env.PORT ?? process.env.VIBE_PILOT_WEB_PORT, 3001);
const hotReloadPort = normalizePort(
  process.env.VIBE_PILOT_EXTENSION_HOT_RELOAD_PORT,
  35729,
);
const backendUrl =
  process.env.VIBE_PILOT_BACKEND_URL ??
  (watchMode
    ? `http://127.0.0.1:${webPort}`
    : "https://vibe-pilotweb-production.up.railway.app");
const hotReloadUrl =
  process.env.VIBE_PILOT_EXTENSION_HOT_RELOAD_URL ??
  `http://127.0.0.1:${hotReloadPort}`;

let buildVersion = 0;
let queuedReason = null;
let rebuildTimer = null;
let rebuilding = false;

await rebuild("startup");

if (!watchMode) {
  process.exit(0);
}

const server = createHotReloadServer();
server.listen(hotReloadPort, "127.0.0.1", () => {
  console.log(`Extension hot reload listening on ${hotReloadUrl}/__hot-reload`);
  console.log(`Extension backend configured for ${backendUrl}`);
});

const watcher = watch(sourceDir, { persistent: true }, (_eventType, filename) => {
  scheduleRebuild(filename ? `src/${filename}` : "src update");
});

watcher.on("error", (error) => {
  console.error("Extension watcher failed.", error);
});

process.on("SIGINT", () => {
  shutdown({ watcher, server });
});

process.on("SIGTERM", () => {
  shutdown({ watcher, server });
});

function scheduleRebuild(reason) {
  queuedReason = reason;

  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }

  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    const nextReason = queuedReason ?? "src update";
    queuedReason = null;
    void rebuild(nextReason);
  }, 120);
}

async function rebuild(reason) {
  if (rebuilding) {
    queuedReason = reason;
    return;
  }

  rebuilding = true;

  try {
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });
    await cp(sourceDir, distDir, { recursive: true });
    await writeFile(path.join(distDir, "config.js"), buildConfigSource());

    buildVersion += 1;

    const sourceLabel = watchMode ? ` after ${reason}` : "";
    console.log(`Extension bundle ready at ${distDir}${sourceLabel}`);

    if (watchMode) {
      broadcastReload(reason);
    }
  } catch (error) {
    console.error("Extension rebuild failed.", error);
  } finally {
    rebuilding = false;

    if (queuedReason && !rebuildTimer) {
      const nextReason = queuedReason;
      queuedReason = null;
      void rebuild(nextReason);
    }
  }
}

function buildConfigSource() {
  return [
    `export const BACKEND_URL = ${JSON.stringify(backendUrl)};`,
    `export const HOT_RELOAD_ENABLED = ${watchMode};`,
    `export const HOT_RELOAD_URL = ${JSON.stringify(hotReloadUrl)};`,
    "",
  ].join("\n");
}

function createHotReloadServer() {
  return http.createServer((request, response) => {
    if (request.url === "/__hot-reload") {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      });

      hotReloadClients.add(response);
      response.write(
        `event: connected\ndata: ${JSON.stringify({
          backendUrl,
          buildVersion,
        })}\n\n`,
      );

      request.on("close", () => {
        hotReloadClients.delete(response);
      });

      return;
    }

    if (request.url === "/__health") {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({
          backendUrl,
          buildVersion,
          hotReloadUrl,
          ok: true,
        }),
      );
      return;
    }

    response.writeHead(404, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  });
}

function broadcastReload(reason) {
  const payload = JSON.stringify({
    buildVersion,
    builtAt: new Date().toISOString(),
    reason,
  });

  for (const client of hotReloadClients) {
    client.write(`event: reload\ndata: ${payload}\n\n`);
  }
}

function shutdown({ watcher, server }) {
  watcher.close();

  for (const client of hotReloadClients) {
    client.end();
  }

  server.close(() => {
    process.exit(0);
  });
}

function normalizePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
