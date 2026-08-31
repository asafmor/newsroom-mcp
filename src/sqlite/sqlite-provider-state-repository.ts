import type { DatabaseSync } from "node:sqlite";
import type { ProviderId, ProviderState } from "../domain/provider.js";
import type { ProviderStateRepository } from "../repositories/provider-state-repository.js";

interface ProviderStateRow {
  state_json: string;
}

export class SqliteProviderStateRepository implements ProviderStateRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(providerId: ProviderId): Promise<ProviderState | null> {
    const row = this.db
      .prepare("SELECT state_json FROM provider_state WHERE provider_id = ?")
      .get(providerId) as ProviderStateRow | undefined;

    return Promise.resolve(row ? (JSON.parse(row.state_json) as ProviderState) : null);
  }

  set(providerId: ProviderId, state: ProviderState): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO provider_state (provider_id, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (provider_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
      )
      .run(providerId, JSON.stringify(state), new Date().toISOString());

    return Promise.resolve();
  }
}
