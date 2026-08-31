import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

const DEFAULT_DB_PATH = "data/newsroom.db";
const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_HN_QUERY = 'AI OR "artificial intelligence" OR LLM OR "machine learning"';
const DEFAULT_GDELT_QUERY =
  '"artificial intelligence" OR "large language model" OR OpenAI OR Anthropic OR DeepMind';
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export interface NewsroomConfig {
  readonly dbPath: string;
  readonly logLevel: string;
  readonly hnQuery: string;
  readonly gdeltQuery: string;
  readonly fetchTimeoutMs: number;
  readonly liveTests: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NewsroomConfig {
  return {
    dbPath: emptyToUndefined(env.NEWSROOM_DB_PATH) ?? DEFAULT_DB_PATH,
    logLevel: emptyToUndefined(env.NEWSROOM_LOG_LEVEL) ?? DEFAULT_LOG_LEVEL,
    hnQuery: emptyToUndefined(env.NEWSROOM_HN_QUERY) ?? DEFAULT_HN_QUERY,
    gdeltQuery: emptyToUndefined(env.NEWSROOM_GDELT_QUERY) ?? DEFAULT_GDELT_QUERY,
    fetchTimeoutMs: parsePositiveInt(
      "NEWSROOM_FETCH_TIMEOUT_MS",
      env.NEWSROOM_FETCH_TIMEOUT_MS,
      DEFAULT_FETCH_TIMEOUT_MS,
    ),
    liveTests: parseBoolean("NEWSROOM_LIVE_TESTS", env.NEWSROOM_LIVE_TESTS, false),
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === "" ? undefined : trimmed;
}

function parseBoolean(name: string, value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be a boolean value`);
}

function parsePositiveInt(name: string, value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}
