import type { ProviderId, ProviderState } from "../domain/provider.js";

export interface ProviderStateRepository {
  get(providerId: ProviderId): Promise<ProviderState | null>;

  set(providerId: ProviderId, state: ProviderState): Promise<void>;
}
