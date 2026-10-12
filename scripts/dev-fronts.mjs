// Starts every front that has a `dev` script (fronts/*/package.json), in parallel, with a prefix on each log line.
// A new front shows up here by itself once it has a package.json with a `dev` script.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "fronts");
const fronts = [];

for (const dir of readdirSync(root, { withFileTypes: true })) {
   const file = join(root, dir.name, "package.json");
   if (!dir.isDirectory() || !existsSync(file)) continue;
   const pkg = JSON.parse(readFileSync(file, "utf8"));
   if (pkg.scripts?.dev) fronts.push({ dir: dir.name, name: pkg.name });
}

if (fronts.length === 0) {
   console.error("No front with a `dev` script found in fronts/*.");
   process.exit(1);
}

const children = fronts.map(({ dir, name }) => {
   const child = spawn(`yarn workspace ${name} dev`, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
   const prefix = `[${dir}] `;
   for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream.on("data", (chunk) => {
         const lines = (pending + chunk).split(/\r?\n/);
         pending = lines.pop() ?? "";
         for (const line of lines) console.log(prefix + line);
      });
   }
   child.on("exit", (code) => console.log(`${prefix}stopped (exit ${code})`));
   return child;
});

console.log(`Starting ${fronts.length} front(s): ${fronts.map((f) => f.dir).join(", ")}`);

function stopAll() {
   for (const child of children) {
      if (child.pid === undefined) continue;
      // On Windows the shell wrapper hides the real process, so end the whole tree.
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      else child.kill("SIGTERM");
   }
   process.exit(0);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
