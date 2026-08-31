import type { ContentProvider, ProviderId } from "../domain/provider.js";

/** Holds every configured `ContentProvider` instance, keyed by its id. */
export class ContentProviderRegistry {
  constructor(private readonly providers: ContentProvider[]) {}

  getAll(): readonly ContentProvider[] {
    return this.providers;
  }

  get(id: ProviderId): ContentProvider | undefined {
    return this.providers.find((provider) => provider.id === id);
  }
}
