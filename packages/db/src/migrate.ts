import { Pool } from "pg";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

// Deliberately plain: a `schema_migrations` ledger table plus a directory of
// numbered .sql files, applied in order inside a transaction each. No DSL,
// no generated client — for a project this size that's more moving parts
// than value. If this were a multi-team codebase I'd reach for
// node-pg-migrate or Flyway instead of hand-rolling this.
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const dir = join(__dirname, "..", "sql");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    const { rows } = await client.query("SELECT filename FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(dir, file), "utf-8");
      console.log(`apply ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    console.log("migrations up to date");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
