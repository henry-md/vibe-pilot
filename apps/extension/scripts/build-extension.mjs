import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const appDir = process.cwd();
const sourceDir = path.join(appDir, "src");
const distDir = path.join(appDir, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(sourceDir, distDir, { recursive: true });

console.log(`Extension bundle ready at ${distDir}`);
