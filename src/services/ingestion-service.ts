import { logger } from "../logger.js";
import type { ContentProviderRegistry } from "../providers/content-provider-registry.js";
import type { ContentItemRepository } from "../repositories/content-item-repository.js";
import type { ProviderStateRepository } from "../repositories/provider-state-repository.js";
import type { ContentProvider } from "../domain/provider.js";

export interface ProviderIngestionResult {
  providerId: string;
  status: "ok" | "failed";
  itemsFetched: number;
  itemsInserted: number;
  duplicates: number;
  /** Present only when status is "failed". */
  error?: string;
}

export interface IngestionResult {
  providersProcessed: number;
  itemsFetched: number;
  itemsInserted: number;
  duplicates: number;
  providers: ProviderIngestionResult[];
}

/** Coordinates every configured provider's poll-fetch-store cycle. */
export class IngestionService {
  constructor(
    private readonly providers: ContentProviderRegistry,
    private readonly items: ContentItemRepository,
    private readonly providerStates: ProviderStateRepository,
  ) {}

  /**
   * Runs every provider's poll-fetch-store cycle concurrently. Each provider
   * owns its own try/catch and returns its own outcome — nothing is shared
   * across the concurrent tasks, so there's no race to guard: `Promise.all`
   * just collects the independent results once every task settles.
   */
  async fetchNewItems(): Promise<IngestionResult> {
    const providerResults = await Promise.all(
      this.providers.getAll().map((provider) => this.fetchOneProvider(provider)),
    );

    return providerResults.reduce<IngestionResult>(
      (result, providerResult) => {
        if (providerResult.status === "ok") {
          result.providersProcessed += 1;
        }
        result.itemsFetched += providerResult.itemsFetched;
        result.itemsInserted += providerResult.itemsInserted;
        result.duplicates += providerResult.duplicates;
        result.providers.push(providerResult);
        return result;
      },
      { providersProcessed: 0, itemsFetched: 0, itemsInserted: 0, duplicates: 0, providers: [] },
    );
  }

  private async fetchOneProvider(
    provider: ContentProvider,
  ): Promise<ProviderIngestionResult> {
    try {
      const state = await this.providerStates.get(provider.id);
      const fetched = await provider.fetchNew(state);

      const stored = await this.items.insertMany(fetched.items);
      await this.providerStates.set(provider.id, fetched.nextState);

      return {
        providerId: provider.id,
        status: "ok",
        itemsFetched: fetched.items.length,
        itemsInserted: stored.inserted.length,
        duplicates: stored.duplicates,
      };
    } catch (error) {
      // ponytail: one flaky source shouldn't sink the whole poll; log and
      // report it as a failed provider instead of throwing.
      logger.error({ err: error, providerId: provider.id }, "provider fetch failed");
      return {
        providerId: provider.id,
        status: "failed",
        itemsFetched: 0,
        itemsInserted: 0,
        duplicates: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
