import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const children = [
  spawnProcess(["run", "dev:web"]),
  spawnProcess(["run", "dev:extension"]),
];

let shuttingDown = false;

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

function spawnProcess(args) {
  const child = spawn(npmCommand, args, {
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    handleExit(child, code, signal);
  });

  return child;
}

function handleExit(child, code, signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const sibling of children) {
    if (sibling !== child && !sibling.killed) {
      sibling.kill("SIGTERM");
    }
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}
