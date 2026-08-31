import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../src/sqlite/sqlite-database.js";

describe("openDatabase", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("creates missing parent directories for a file-backed database", () => {
    tempDir = mkdtempSync(join(tmpdir(), "newsroom-mcp-db-test-"));
    const dbPath = join(tempDir, "nested", "deeper", "newsroom.db");

    expect(existsSync(dbPath)).toBe(false);

    const db = openDatabase(dbPath);

    expect(existsSync(dbPath)).toBe(true);
    db.close();
  });

  it("applies migrations on an in-memory database without touching the filesystem", () => {
    const db = openDatabase(":memory:");

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(
      expect.arrayContaining(["content_items", "stories", "story_items", "provider_state"]),
    );
    db.close();
  });
});
