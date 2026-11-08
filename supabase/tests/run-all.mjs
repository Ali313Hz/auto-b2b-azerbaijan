// Runs every *.test.mjs file one after another; exits 1 if any fails.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const files = fs.readdirSync(import.meta.dirname).filter((f) => f.endsWith(".test.mjs")).sort();
let failed = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, [file], {
    cwd: import.meta.dirname,
    encoding: "utf8",
  });
  const summary = (result.stdout.match(/PASSED \d+, FAILED \d+[\s\S]*/) ?? ["no result"])[0].trim();
  console.log(`${file}: ${summary}`);
  if (result.status !== 0) failed++;
}

process.exitCode = failed ? 1 : 0;
