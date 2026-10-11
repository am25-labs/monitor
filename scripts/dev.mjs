import { spawn } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";

if (!existsSync(".dev.vars")) copyFileSync(".dev.vars.example", ".dev.vars");
const children = ["dev:ui", "dev:worker"].map((script) =>
  spawn("pnpm", ["run", script], { stdio: "inherit" })
);
function stop() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", stop);
