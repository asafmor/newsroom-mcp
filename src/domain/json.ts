/**
 * JSON-compatible value types. `ProviderState` is stored as a JSON blob in
 * SQLite, so provider state must stay representable in plain JSON.
 */
export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = Record<string, JsonValue>;
