import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  CreateStoryInput,
  Story,
  StoryId,
  StoryItem,
  StoryStatus,
  UpdateStoryInput,
} from "../domain/story.js";
import type { AttachedContentItem, StoryRepository } from "../repositories/story-repository.js";

interface StoryRow {
  id: string;
  title: string;
  summary: string;
  relevance_score: number;
  importance_score: number;
  first_seen_at: string;
  last_item_attached_at: string;
  last_meaningful_update_at: string;
  status: string;
}

interface AttachedContentRow {
  content_item_id: string;
  provider_id: string;
  title: string;
  url: string;
  published_at: string;
  contribution: string;
  reason: string | null;
  attached_at: string;
}

export class SqliteStoryRepository implements StoryRepository {
  constructor(private readonly db: DatabaseSync) {}

  // async for the same reason as attachItem: keep a synchronous throw inside
  // the transaction surfacing as a rejected promise.
  async create(input: CreateStoryInput): Promise<Story> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO stories
            (id, title, summary, relevance_score, importance_score,
             first_seen_at, last_item_attached_at, last_meaningful_update_at,
             status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(id, input.title, input.summary, input.relevanceScore, input.importanceScore, now, now, now, now, now);

      const attachStmt = this.db.prepare(
        `INSERT INTO story_items (story_id, content_item_id, contribution, reason, attached_at)
         VALUES (?, ?, 'supporting', NULL, ?)`,
      );
      const markLinkedStmt = this.db.prepare("UPDATE content_items SET processing_status = 'linked' WHERE id = ?");

      for (const contentItemId of input.contentItemIds) {
        attachStmt.run(id, contentItemId, now);
        markLinkedStmt.run(contentItemId);
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return Promise.resolve({
      id,
      title: input.title,
      summary: input.summary,
      relevanceScore: input.relevanceScore,
      importanceScore: input.importanceScore,
      firstSeenAt: new Date(now),
      lastItemAttachedAt: new Date(now),
      lastMeaningfulUpdateAt: new Date(now),
      status: "active",
    });
  }

  findById(id: StoryId): Promise<Story | null> {
    const row = this.db.prepare("SELECT * FROM stories WHERE id = ?").get(id) as StoryRow | undefined;
    return Promise.resolve(row ? this.toDomain(row) : null);
  }

  findActive(options?: { limit?: number; offset?: number }): Promise<Story[]> {
    const pagination = options?.limit === undefined ? "" : "LIMIT ? OFFSET ?";
    const params = options?.limit === undefined ? [] : [options.limit, options.offset ?? 0];

    const rows = this.db
      .prepare(
        `SELECT * FROM stories WHERE status = 'active'
         ORDER BY importance_score DESC, last_meaningful_update_at DESC
         ${pagination}`,
      )
      .all(...params) as unknown as StoryRow[];

    return Promise.resolve(rows.map((row) => this.toDomain(row)));
  }

  countActive(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM stories WHERE status = 'active'").get() as {
      count: number;
    };
    return Promise.resolve(row.count);
  }

  async update(id: StoryId, patch: UpdateStoryInput): Promise<Story> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Cannot update story ${id}: it does not exist`);
    }

    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (patch.title !== undefined) {
      fields.push("title = ?");
      values.push(patch.title);
    }
    if (patch.summary !== undefined) {
      fields.push("summary = ?");
      values.push(patch.summary);
    }
    if (patch.relevanceScore !== undefined) {
      fields.push("relevance_score = ?");
      values.push(patch.relevanceScore);
    }
    if (patch.importanceScore !== undefined) {
      fields.push("importance_score = ?");
      values.push(patch.importanceScore);
    }

    fields.push("updated_at = ?");
    values.push(new Date().toISOString());

    this.db.prepare(`UPDATE stories SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`Story ${id} disappeared during update`);
    }
    return updated;
  }

  archive(id: StoryId): Promise<void> {
    this.db
      .prepare("UPDATE stories SET status = 'archived', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return Promise.resolve();
  }

  archiveStale(cutoff: Date): Promise<number> {
    const info = this.db
      .prepare(
        `UPDATE stories SET status = 'archived', updated_at = ?
         WHERE status = 'active' AND last_meaningful_update_at < ?`,
      )
      .run(new Date().toISOString(), cutoff.toISOString());

    return Promise.resolve(Number(info.changes));
  }

  // async so a synchronous throw (e.g. the UNIQUE constraint below) surfaces
  // as a rejected promise, matching the interface's Promise<void> contract.
  async attachItem(link: StoryItem): Promise<void> {
    const attachedAt = link.attachedAt.toISOString();

    this.db.exec("BEGIN");
    try {
      // UNIQUE(story_id, content_item_id) makes a duplicate attach throw here
      // rather than silently succeeding, per the single-writer design.
      this.db
        .prepare(
          `INSERT INTO story_items (story_id, content_item_id, contribution, reason, attached_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(link.storyId, link.contentItemId, link.contribution, link.reason ?? null, attachedAt);

      if (link.contribution === "meaningful-update") {
        this.db
          .prepare(
            "UPDATE stories SET last_item_attached_at = ?, last_meaningful_update_at = ?, updated_at = ? WHERE id = ?",
          )
          .run(attachedAt, attachedAt, new Date().toISOString(), link.storyId);
      } else {
        this.db
          .prepare("UPDATE stories SET last_item_attached_at = ?, updated_at = ? WHERE id = ?")
          .run(attachedAt, new Date().toISOString(), link.storyId);
      }

      this.db
        .prepare("UPDATE content_items SET processing_status = 'linked' WHERE id = ?")
        .run(link.contentItemId);

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return Promise.resolve();
  }

  findAttachedContent(storyId: StoryId): Promise<AttachedContentItem[]> {
    const rows = this.db
      .prepare(
        `SELECT
          ci.id AS content_item_id,
          ci.provider_id AS provider_id,
          ci.title AS title,
          ci.url AS url,
          ci.published_at AS published_at,
          si.contribution AS contribution,
          si.reason AS reason,
          si.attached_at AS attached_at
         FROM story_items si
         JOIN content_items ci ON ci.id = si.content_item_id
         WHERE si.story_id = ?
         ORDER BY si.attached_at ASC`,
      )
      .all(storyId) as unknown as AttachedContentRow[];

    return Promise.resolve(
      rows.map((row) => ({
        contentItemId: row.content_item_id,
        providerId: row.provider_id,
        title: row.title,
        url: row.url,
        publishedAt: new Date(row.published_at),
        contribution: row.contribution as StoryItem["contribution"],
        reason: row.reason ?? undefined,
        attachedAt: new Date(row.attached_at),
      })),
    );
  }

  private toDomain(row: StoryRow): Story {
    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      relevanceScore: row.relevance_score,
      importanceScore: row.importance_score,
      firstSeenAt: new Date(row.first_seen_at),
      lastItemAttachedAt: new Date(row.last_item_attached_at),
      lastMeaningfulUpdateAt: new Date(row.last_meaningful_update_at),
      status: row.status as StoryStatus,
    };
  }
}
