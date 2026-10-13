// Stages a self-contained folder (the bundle has every dependency) and deploys it to the linked Vercel project.
// The workspace package.json cannot be installed by Vercel (it depends on @mostro/shared), hence the staging folder.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

execSync("yarn build:vercel", { stdio: "inherit" });
rmSync("deploy", { recursive: true, force: true });
cpSync("deploy-template", "deploy", { recursive: true });
mkdirSync("deploy/server", { recursive: true });
cpSync("dist/vercel.js", "deploy/server/vercel.js");
if (existsSync(".vercel")) cpSync(".vercel", "deploy/.vercel", { recursive: true });
execSync(`vercel deploy --prod --yes ${process.argv.slice(2).join(" ")}`, { cwd: "deploy", stdio: "inherit" });
