import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Opens the SQLite database at `path` (or `:memory:` for tests), applies
 * pending migrations, and configures it for a single local writer.
 *
 * Rollback is intentionally not implemented: SQLite is one file, so
 * "rollback" means restoring a copied backup of that file, not replaying
 * migrations backward. See docs/sqlite-schema.md.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);

  // WAL lets the periodic agent read the feed while ingestion writes new
  // items, without blocking either side. NORMAL synchronous is the
  // recommended pairing with WAL: still crash-safe, far less fsync overhead.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");

  runMigrations(db);

  return db;
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      applied_at  TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    // Migration files are named `NNN_description.sql`; the leading number is
    // the version, kept as a plain sortable integer rather than a timestamp
    // since this project has one writer and no branching migration history.
    const version = Number(file.split("_")[0]);

    if (applied.has(version)) {
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${String(error)}`, { cause: error });
    }
  }
}
