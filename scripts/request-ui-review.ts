import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
        "--sandbox",
        "workspace-write",
        "--approve-for-me",
        "--output-last-message",
        reportPath,
        "-",
      ]
    : [
        "exec",
        "resume",
        "--json",
        "--sandbox",
        "workspace-write",
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

function buildPrompt(worktree: string, runDirectory: string, request: string): string {
  return `You are the dedicated read-only UI/UX reviewer for newsroom-mcp.

Read and follow ${worktree}/.agents/skills/newsroom-ui-review/SKILL.md completely.

Current worktree: ${worktree}
Evidence directory for this run: ${runDirectory}

Review request:
${request}

Re-read the current checkout even if this is a resumed session. Do not edit
the product. Save visual evidence only inside the evidence directory and
return the Markdown report specified by the skill.`;
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

  let state: ReviewerState | undefined;
  if (existsSync(statePath)) {
    state = JSON.parse(readFileSync(statePath, "utf8")) as ReviewerState;
    if (realpathSync(state.worktree) !== options.worktree) {
      throw new Error("Stored reviewer session belongs to a different worktree.");
    }
  }

  console.error(`UI review evidence: ${runDirectory}`);
  const prompt = buildPrompt(options.worktree, runDirectory, options.request);
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
