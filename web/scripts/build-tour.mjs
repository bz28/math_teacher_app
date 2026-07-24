// Build the product tour (demo/) with base "/tour/" and stage it into
// web/public/tour so veradicai.com/tour serves it same-origin. Runs as part of
// the web build. The output is git-ignored (see .gitignore) and regenerated
// every build, so demo/ stays the single source of truth for the tour.
import { execSync } from "node:child_process";
import { rmSync, cpSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = resolve(webDir, "..", "demo");
const outDir = resolve(webDir, "public", "tour");

if (!existsSync(demoDir)) {
  console.warn(`[build-tour] demo/ not found at ${demoDir} — skipping tour build`);
  process.exit(0);
}

const run = (cmd, env) =>
  execSync(cmd, { cwd: demoDir, stdio: "inherit", env: { ...process.env, ...env } });

// --include=dev is required: Vercel builds run with NODE_ENV=production, which
// makes npm omit devDependencies — but the demo's build tools (vite,
// typescript, @types/node) are devDeps, so tsc/vite would fail without them.
console.log("[build-tour] installing demo/ deps…");
run("npm ci --include=dev --no-audit --no-fund");

console.log("[build-tour] building demo/ with base /tour/ …");
run("npm run build", { DEMO_BASE: "/tour/" });

rmSync(outDir, { recursive: true, force: true });
mkdirSync(dirname(outDir), { recursive: true });
cpSync(resolve(demoDir, "dist"), outDir, { recursive: true });
console.log(`[build-tour] staged tour → ${outDir}`);
