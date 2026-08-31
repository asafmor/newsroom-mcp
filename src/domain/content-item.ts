import type { JsonObject } from "./json.js";
import type { ProviderId } from "./provider.js";

/**
 * Category of normalized content. Kept intentionally small; extend when a
 * new provider genuinely needs a kind that doesn't fit an existing one.
 */
export type ContentKind =
  | "article"
  | "discussion"
  | "paper"
  | "release"
  | "model"
  | "video"
  | "social-post";

export type ContentItemId = string;

/**
 * Normalized representation returned by every `ContentProvider`. Providers
 * should preserve provider-specific detail inside `metadata`, but downstream
 * code (services, tools) should not depend heavily on it.
 */
export interface ContentItem {
  providerId: ProviderId;
  externalId: string;

  kind: ContentKind;

  title: string;
  url: string;

  publishedAt: Date;

  authors?: string[];
  description?: string;
  content?: string;

  metadata?: JsonObject;
}

export type ContentProcessingStatus = "pending" | "linked" | "ignored";

/** The stored, database-backed form of a `ContentItem`. */
export interface StoredContentItem extends ContentItem {
  id: ContentItemId;
  discoveredAt: Date;
  processingStatus: ContentProcessingStatus;
}
