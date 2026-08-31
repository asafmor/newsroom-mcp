import type { ContentItem, ContentItemId, StoredContentItem } from "../domain/content-item.js";

export interface InsertContentItemsResult {
  inserted: StoredContentItem[];
  /** Count of items skipped because `(providerId, externalId)` already existed. */
  duplicates: number;
}

/**
 * Persistence for content items. Enforces exact-duplicate prevention via a
 * `(provider_id, external_id)` uniqueness constraint at the storage layer —
 * callers must not rely on application code alone for that guarantee.
 */
export interface ContentItemRepository {
  insertMany(items: ContentItem[]): Promise<InsertContentItemsResult>;

  findPending(limit: number): Promise<StoredContentItem[]>;

  findById(id: ContentItemId): Promise<StoredContentItem | null>;

  markLinked(id: ContentItemId): Promise<void>;

  markIgnored(id: ContentItemId): Promise<void>;
}
