import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Applies database/flyway/application/sql/*.sql to a hosted Postgres (Neon) that has no Flyway.
 * Uses MIGRATE_DATABASE_URL (owner connection) or DATABASE_URL. The `${appUser}` placeholder becomes the connecting role.
 * Applied versions are remembered in mostro_app.schema_migrations, so it can be re-run safely.
 */
async function main(): Promise<void> {
   const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
   if (!url) throw new Error("Set MIGRATE_DATABASE_URL or DATABASE_URL.");
   const dir = join(__dirname, "..", "..", "database", "flyway", "application", "sql");
   const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

   const client = new Client({ connectionString: url });
   await client.connect();
   try {
      await client.query("CREATE SCHEMA IF NOT EXISTS mostro_app");
      await client.query("CREATE TABLE IF NOT EXISTS mostro_app.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      const { rows } = await client.query<{ version: string }>("SELECT version FROM mostro_app.schema_migrations");
      const done = new Set(rows.map((r) => r.version));
      const { rows: who } = await client.query<{ u: string }>("SELECT current_user AS u");
      for (const file of files) {
         if (done.has(file)) continue;
         const sql = readFileSync(join(dir, file), "utf8").replaceAll("${appUser}", `"${who[0]!.u}"`);
         await client.query("BEGIN");
         try {
            await client.query(sql);
            await client.query("INSERT INTO mostro_app.schema_migrations (version) VALUES ($1)", [file]);
            await client.query("COMMIT");
            console.log(`applied ${file}`);
         } catch (err) {
            await client.query("ROLLBACK");
            throw err;
         }
      }
      console.log("database up to date");
   } finally {
      await client.end();
   }
}

void main();
