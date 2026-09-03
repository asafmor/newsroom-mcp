import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { createServer, type Server } from "node:net";
import { join, resolve } from "node:path";

interface Options {
  readonly format: "json" | "markdown";
  readonly worktree: string;
  readonly request: string;
}

interface ReviewerState {
  readonly sessionId: string;
  readonly worktree: string;
}

interface CodexRun {
  readonly exitCode: number;
  readonly sessionId?: string;
}

interface PreparedReviewEnvironment {
  readonly chromePath?: string;
  readonly feedGeneratedAt: string;
  readonly feedSource: string;
  readonly mcpPort: number;
  readonly sitePort: number;
  readonly siteRoot: string;
}

function repositoryFingerprint(worktree: string): string {
  const hash = createHash("sha256");
  hash.update(execFileSync("git", ["diff", "--binary", "HEAD", "--"], { cwd: worktree }));

  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: worktree, encoding: "utf8" },
  )
    .split("\0")
    .filter((path) => path !== "")
    .sort();

  for (const path of untracked) {
    hash.update(path);
    hash.update(readFileSync(resolve(worktree, path)));
  }

  return hash.digest("hex");
}

const HELP = `Usage:
  npm run review:ui -- [--worktree PATH] [--format markdown|json] [--request TEXT]
  npm run review:ui -- [--worktree PATH] [--format markdown|json] --request-file PATH
  printf '%s' "request" | npm run review:ui -- [--worktree PATH]

Runs one read-only UI/UX consultation. The first call creates a dedicated
Codex reviewer session for the resolved worktree; later calls resume it.`;

function readOptions(argv: readonly string[]): Options {
  let format: "json" | "markdown" = "markdown";
  let worktree = process.cwd();
  let request: string | undefined;
  let requestFile: string | undefined;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      console.log(HELP);
      process.exit(0);
    }

    if (argument === "--worktree") {
      const value = argv.at(index + 1);
      if (value === undefined) throw new Error("--worktree requires a path.");
      worktree = value;
      index += 1;
      continue;
    }

    if (argument === "--request") {
      const value = argv.at(index + 1);
      if (value === undefined) throw new Error("--request requires text.");
      request = value;
      index += 1;
      continue;
    }

    if (argument === "--request-file") {
      const value = argv.at(index + 1);
      if (value === undefined) throw new Error("--request-file requires a path.");
      requestFile = value;
      index += 1;
      continue;
    }

    if (argument === "--format") {
      const value = argv.at(index + 1);
      if (value !== "json" && value !== "markdown") {
        throw new Error("--format must be either markdown or json.");
      }
      format = value;
      index += 1;
      continue;
    }

    positional.push(argument);
  }

  if (request !== undefined && requestFile !== undefined) {
    throw new Error("Use either --request or --request-file, not both.");
  }

  if (requestFile !== undefined) {
    request = readFileSync(resolve(requestFile), "utf8").trim();
  } else if (request === undefined && positional.length > 0) {
    request = positional.join(" ").trim();
  } else if (request === undefined && !process.stdin.isTTY) {
    request = readFileSync(0, "utf8").trim();
  }

  const normalizedRequest = request?.trim();

  return {
    format,
    worktree: realpathSync(resolve(worktree)),
    request: normalizedRequest === undefined || normalizedRequest === ""
      ? "Review the current implemented UI and any uncommitted UI changes."
      : normalizedRequest,
  };
}

function extractSessionId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const record = value as Record<string, unknown>;
  if (record.type === "thread.started" && typeof record.thread_id === "string") {
    return record.thread_id;
  }

  for (const child of Object.values(record)) {
    const found = extractSessionId(child);
    if (found !== undefined) return found;
  }

  return undefined;
}

function executable(path: string | undefined): path is string {
  if (path === undefined || path === "") return false;

  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findBundledChrome(directory: string, depth = 0): string | undefined {
  if (depth > 5 || !existsSync(directory)) return undefined;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isFile() && ["chrome", "chromium", "headless_shell"].includes(entry.name) && executable(candidate)) {
      return candidate;
    }
    if (entry.isDirectory()) {
      const found = findBundledChrome(candidate, depth + 1);
      if (found !== undefined) return found;
    }
  }

  return undefined;
}

function discoverChrome(): string | undefined {
  for (const candidate of [
    process.env.MCP_USE_CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
  ]) {
    if (executable(candidate)) return candidate;
  }

  for (const command of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      const candidate = execFileSync("which", [command], { encoding: "utf8" }).trim();
      if (executable(candidate)) return candidate;
    } catch {
      // Try the next system browser, then Playwright's bundled Chromium.
    }
  }

  return findBundledChrome(resolve(homedir(), ".cache", "ms-playwright"));
}

function tryGitShow(worktree: string, revision: string): Buffer | undefined {
  try {
    return execFileSync("git", ["show", `${revision}:feed.json`], {
      cwd: worktree,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}

function prepareStandaloneSite(worktree: string, runDirectory: string): Omit<PreparedReviewEnvironment, "chromePath" | "mcpPort" | "sitePort"> {
  try {
    execFileSync("git", ["fetch", "--quiet", "origin", "feed"], {
      cwd: worktree,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    console.error("Could not refresh origin/feed; using the newest locally available feed snapshot.");
  }

  const snapshots: readonly (readonly [string, Buffer | undefined])[] = [
    ["origin/feed:feed.json", tryGitShow(worktree, "origin/feed")],
    ["feed:feed.json", tryGitShow(worktree, "feed")],
    ["site/feed.json", existsSync(resolve(worktree, "site", "feed.json"))
      ? readFileSync(resolve(worktree, "site", "feed.json"))
      : undefined],
  ];
  const selected = snapshots.find(([, contents]) => contents !== undefined);
  if (selected?.[1] === undefined) {
    throw new Error("No feed.json snapshot is available for standalone UI review.");
  }

  const [feedSource, feedContents] = selected;
  const parsed = JSON.parse(feedContents.toString("utf8")) as { generatedAt?: unknown; stories?: unknown };
  if (typeof parsed.generatedAt !== "string" || !Array.isArray(parsed.stories)) {
    throw new Error(`${feedSource} is not a valid published feed snapshot.`);
  }

  const standaloneRoot = resolve(runDirectory, "standalone");
  const siteRoot = resolve(standaloneRoot, "site");
  mkdirSync(siteRoot, { recursive: true });
  cpSync(resolve(worktree, "site", "index.html"), resolve(siteRoot, "index.html"));
  cpSync(resolve(worktree, "site", "src"), resolve(siteRoot, "src"), { recursive: true });
  cpSync(resolve(worktree, "views"), resolve(standaloneRoot, "views"), { recursive: true });
  writeFileSync(resolve(siteRoot, "feed.json"), feedContents);

  return {
    feedGeneratedAt: parsed.generatedAt,
    feedSource,
    siteRoot,
  };
}

async function openEphemeralServer(): Promise<{ readonly port: number; readonly server: Server }> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a local review port.");
  }
  return { port: address.port, server };
}

async function allocateReviewPorts(): Promise<readonly [number, number]> {
  const reservations = await Promise.all([openEphemeralServer(), openEphemeralServer()]);
  await Promise.all(reservations.map(async ({ server }) => {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error === undefined) resolveClose();
        else rejectClose(error);
      });
    });
  }));
  return [reservations[0].port, reservations[1].port];
}

async function runCodex(
  worktree: string,
  prompt: string,
  reportPath: string,
  resumeSessionId?: string,
): Promise<CodexRun> {
  const args = resumeSessionId === undefined
    ? [
        "exec",
        "-C",
        worktree,
        "--json",
        "--approve-for-me",
        "--output-last-message",
        reportPath,
        "-",
      ]
    : [
        "exec",
        "resume",
        "--json",
        "--approve-for-me",
        "--output-last-message",
        reportPath,
        resumeSessionId,
        "-",
      ];

  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn("codex", args, {
      cwd: worktree,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let buffer = "";
    let sessionId: string | undefined;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        try {
          sessionId ??= extractSessionId(JSON.parse(line));
        } catch {
          // Ignore incidental text. The exit code and report file remain the
          // authoritative result.
        }
      }
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (buffer.trim() !== "") {
        try {
          sessionId ??= extractSessionId(JSON.parse(buffer));
        } catch {
          // See the streaming parser above.
        }
      }
      resolveRun({ exitCode: code ?? 1, sessionId });
    });
    child.stdin.end(prompt);
  });
}

function buildPrompt(
  worktree: string,
  runDirectory: string,
  request: string,
  environment: PreparedReviewEnvironment,
): string {
  const chromeInstruction = environment.chromePath === undefined
    ? "No Chrome executable was auto-discovered. If direct MCP App capture fails, report MCP App as not verified."
    : `MCP_USE_CHROME_PATH is set to: ${environment.chromePath}`;

  return `You are the dedicated read-only UI/UX reviewer for newsroom-mcp.

Read and follow ${worktree}/.agents/skills/newsroom-ui-review/SKILL.md completely.

Current worktree: ${worktree}
Evidence directory for this run: ${runDirectory}

Prepared standalone review host:
- Site root: ${environment.siteRoot}
- URL: http://127.0.0.1:${String(environment.sitePort)}
- Feed snapshot: ${environment.feedSource}
- Feed generatedAt: ${environment.feedGeneratedAt}

Fresh MCP development host:
- Start from the worktree with: npx mcp-use dev --views-dir views --no-open --host 127.0.0.1 --port ${String(environment.mcpPort)}
- MCP endpoint: http://127.0.0.1:${String(environment.mcpPort)}/mcp
- ${chromeInstruction}

Review request:
${request}

Re-read the current checkout even if this is a resumed session. Do not edit
the product. Do not run npm run dev:site: the launcher already staged current
worktree UI code and the newest available published feed without modifying
site/feed.json.

For mobile and desktop web, start the prepared site with:
npx vite "${environment.siteRoot}" --host 127.0.0.1 --port ${String(environment.sitePort)} --strictPort

For required MCP App evidence, start the fresh MCP development host above,
then run this direct view capture from the worktree:
MCP_USE_CHROME_PATH="${environment.chromePath ?? "<chrome-path>"}" npx mcp-use screenshot --mcp http://127.0.0.1:${String(environment.mcpPort)}/mcp --tool get-feed '{"limit":50}' --output "${resolve(runDirectory, "mcp-app-overview.png")}" --width 768 --height 720 --theme light --delay 1500 --timeout 60000 --json

Visually inspect mcp-app-overview.png with the image viewer. This direct
view-backed tool capture is the required MCP App overview. An Inspector
dashboard or tool form without the rendered get-feed app is not MCP App
evidence. Inspector use is optional for extra interaction evidence, but any
Inspector screenshot cited as MCP App evidence must visibly contain the
rendered get-feed cards and controls. If direct capture fails, say MCP App was
not verified and include the exact failure; never substitute the Inspector
shell or standalone site.

The CLI crops its PNG to the rendered widget bounds, so an output image taller
than --height is not by itself proof of clipping or host overflow. Only report
a sizing defect when actual rendered host behavior supports it. The required
mobile, desktop, and MCP overview images are a minimum, not a cap: steer your
own exploration and capture as many additional non-duplicative screenshots and
states as the review warrants.

Save visual evidence only inside the evidence directory, stop only the local
servers you started, do not alter any repository file, and return the Markdown
report specified by the skill.`;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const skillPath = resolve(options.worktree, ".agents/skills/newsroom-ui-review/SKILL.md");

  if (!existsSync(skillPath)) {
    throw new Error(`The target worktree does not contain ${skillPath}.`);
  }

  const stateDirectory = resolve(options.worktree, ".ui-review");
  const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const runDirectory = resolve(stateDirectory, "runs", runId);
  const reportPath = resolve(runDirectory, "report.md");
  const statePath = resolve(stateDirectory, "reviewer-session.json");
  mkdirSync(runDirectory, { recursive: true });
  const initialFingerprint = repositoryFingerprint(options.worktree);

  const standalone = prepareStandaloneSite(options.worktree, runDirectory);
  const [sitePort, mcpPort] = await allocateReviewPorts();
  const chromePath = discoverChrome();
  if (chromePath !== undefined) process.env.MCP_USE_CHROME_PATH = chromePath;
  const environment: PreparedReviewEnvironment = {
    ...standalone,
    chromePath,
    mcpPort,
    sitePort,
  };
  writeFileSync(
    resolve(runDirectory, "review-inputs.json"),
    `${JSON.stringify(environment, null, 2)}\n`,
  );

  let state: ReviewerState | undefined;
  if (existsSync(statePath)) {
    state = JSON.parse(readFileSync(statePath, "utf8")) as ReviewerState;
    if (realpathSync(state.worktree) !== options.worktree) {
      throw new Error("Stored reviewer session belongs to a different worktree.");
    }
  }

  console.error(`UI review evidence: ${runDirectory}`);
  const prompt = buildPrompt(options.worktree, runDirectory, options.request, environment);
  let result = await runCodex(options.worktree, prompt, reportPath, state?.sessionId);

  if (result.exitCode !== 0 && state !== undefined) {
    console.error("Stored reviewer session could not resume; starting a new dedicated session.");
    rmSync(statePath, { force: true });
    result = await runCodex(options.worktree, prompt, reportPath);
  }

  if (result.exitCode !== 0) {
    throw new Error(`Codex reviewer exited with status ${String(result.exitCode)}.`);
  }

  if (repositoryFingerprint(options.worktree) !== initialFingerprint) {
    throw new Error(
      "The UI reviewer changed repository files. Inspect the worktree; reviewer output is invalid.",
    );
  }

  const sessionId = result.sessionId ?? state?.sessionId;
  if (sessionId === undefined) {
    throw new Error("Codex completed the review but did not report a session id.");
  }

  writeFileSync(
    statePath,
    `${JSON.stringify({ sessionId, worktree: options.worktree } satisfies ReviewerState, null, 2)}\n`,
  );

  if (!existsSync(reportPath)) {
    throw new Error("Codex completed without writing the review report.");
  }

  const report = readFileSync(reportPath, "utf8");
  const output = {
    status: "completed",
    sessionId,
    worktree: options.worktree,
    runDirectory,
    reportPath,
    report,
  } as const;
  writeFileSync(resolve(runDirectory, "result.json"), `${JSON.stringify(output, null, 2)}\n`);

  process.stdout.write(options.format === "json" ? `${JSON.stringify(output)}\n` : report);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
