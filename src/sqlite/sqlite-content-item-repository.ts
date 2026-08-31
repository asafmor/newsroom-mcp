import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  ContentItem,
  ContentItemId,
  ContentKind,
  ContentProcessingStatus,
  StoredContentItem,
} from "../domain/content-item.js";
import type { ContentItemRepository, InsertContentItemsResult } from "../repositories/content-item-repository.js";

/** `get-unprocessed-items` never surfaces items older than this — stale items just age out. */
const MAX_PENDING_ITEM_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface ContentItemRow {
  id: string;
  provider_id: string;
  external_id: string;
  kind: string;
  title: string;
  url: string;
  published_at: string;
  authors_json: string | null;
  description: string | null;
  content: string | null;
  metadata_json: string | null;
  discovered_at: string;
  processing_status: string;
}

export class SqliteContentItemRepository implements ContentItemRepository {
  constructor(private readonly db: DatabaseSync) {}

  async insertMany(items: ContentItem[]): Promise<InsertContentItemsResult> {
    // INSERT OR IGNORE + RETURNING lets us tell "inserted" from "duplicate"
    // per row without try/catch around each statement.
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO content_items
        (id, provider_id, external_id, kind, title, url, published_at,
         authors_json, description, content, metadata_json, discovered_at, processing_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      RETURNING *
    `);

    const inserted: StoredContentItem[] = [];
    let duplicates = 0;

    for (const item of items) {
      const row = stmt.get(
        randomUUID(),
        item.providerId,
        item.externalId,
        item.kind,
        item.title,
        item.url,
        item.publishedAt.toISOString(),
        item.authors ? JSON.stringify(item.authors) : null,
        item.description ?? null,
        item.content ?? null,
        item.metadata ? JSON.stringify(item.metadata) : null,
        new Date().toISOString(),
      ) as ContentItemRow | undefined;

      if (row) {
        inserted.push(this.toDomain(row));
      } else {
        duplicates++;
      }
    }

    return Promise.resolve({ inserted, duplicates });
  }

  findPending(limit: number): Promise<StoredContentItem[]> {
    const maxAgeCutoff = new Date(Date.now() - MAX_PENDING_ITEM_AGE_MS).toISOString();

    const rows = this.db
      .prepare(
        `SELECT * FROM content_items
         WHERE processing_status = 'pending' AND published_at >= ?
         ORDER BY discovered_at ASC
         LIMIT ?`,
      )
      .all(maxAgeCutoff, limit) as unknown as ContentItemRow[];

    return Promise.resolve(rows.map((row) => this.toDomain(row)));
  }

  findById(id: ContentItemId): Promise<StoredContentItem | null> {
    const row = this.db.prepare("SELECT * FROM content_items WHERE id = ?").get(id) as
      | ContentItemRow
      | undefined;

    return Promise.resolve(row ? this.toDomain(row) : null);
  }

  markLinked(id: ContentItemId): Promise<void> {
    return this.setProcessingStatus(id, "linked");
  }

  markIgnored(id: ContentItemId): Promise<void> {
    return this.setProcessingStatus(id, "ignored");
  }

  private setProcessingStatus(id: ContentItemId, status: ContentProcessingStatus): Promise<void> {
    this.db.prepare("UPDATE content_items SET processing_status = ? WHERE id = ?").run(status, id);
    return Promise.resolve();
  }

  private toDomain(row: ContentItemRow): StoredContentItem {
    return {
      id: row.id,
      providerId: row.provider_id,
      externalId: row.external_id,
      kind: row.kind as ContentKind,
      title: row.title,
      url: row.url,
      publishedAt: new Date(row.published_at),
      authors: row.authors_json ? (JSON.parse(row.authors_json) as string[]) : undefined,
      description: row.description ?? undefined,
      content: row.content ?? undefined,
      metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as ContentItem["metadata"]) : undefined,
      discoveredAt: new Date(row.discovered_at),
      processingStatus: row.processing_status as ContentProcessingStatus,
    };
  }
}
