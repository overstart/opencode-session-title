// opencode-session-title unit tests
import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import { formatTitle, updateTmuxTitle } from "./index.ts";
import { createLogger } from "./logger.ts";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type winston from "winston";

function makeTestLogger(debug = true): { logger: winston.Logger; logDir: string } {
  const logDir = mkdtempSync(join(tmpdir(), "opencode-test-"));
  const logger = createLogger({ debug, logDir });
  return { logger, logDir };
}

function readLogs(logDir: string): Record<string, unknown>[] {
  let files: string[];
  try {
    files = readdirSync(logDir).filter((f: string) => f.endsWith(".log"));
  } catch {
    return [];
  }
  const entries: Record<string, unknown>[] = [];
  for (const f of files) {
    const content = readFileSync(join(logDir, f), "utf-8").trim();
    if (!content) continue;
    for (const line of content.split("\n")) {
      try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
  }
  return entries;
}

// ponytail: winston DailyRotateFile buffers writes; wait for flush
function flushLogs(): Promise<void> {
  return new Promise((r) => setTimeout(r, 200));
}

// ── formatTitle ──

describe("formatTitle", () => {
  it("default template with busy status", () => {
    expect(formatTitle("[{icon}] {title}", "修复登录bug", "busy")).toBe("[●] 修复登录bug");
  });

  it("default template with idle status", () => {
    expect(formatTitle("[{icon}] {title}", "测试", "idle")).toBe("[○] 测试");
  });

  it("default template with retry status", () => {
    expect(formatTitle("[{icon}] {title}", "重试中", "retry")).toBe("[↻] 重试中");
  });

  it("custom template {title} [{status}]", () => {
    expect(formatTitle("{title} [{status}]", "测试", "idle")).toBe("测试 [idle]");
  });

  it("custom template {status}: {title}", () => {
    expect(formatTitle("{status}: {title}", "标题", "busy")).toBe("busy: 标题");
  });

  it("unknown status falls back to ?", () => {
    expect(formatTitle("[{icon}] {title}", "测试", "unknown")).toBe("[?] 测试");
  });

  it("empty title", () => {
    expect(formatTitle("[{icon}] {title}", "", "idle")).toBe("[○] ");
  });
});

// ── updateTmuxTitle ──

describe("updateTmuxTitle", () => {
  let logDir: string;

  afterEach(() => {
    if (logDir) rmSync(logDir, { recursive: true, force: true });
  });

  it("skips when TMUX env is not set", async () => {
    delete process.env.TMUX;
    const { logger, logDir: dir } = makeTestLogger();
    logDir = dir;
    const $ = () => { throw new Error("should not be called"); };
    await updateTmuxTitle({ $, title: "test", dryRun: false, logger });
    await flushLogs();
    const entries = readLogs(logDir);
    const skip = entries.find((e) => e.message === "tmux skipped");
    expect(skip).toBeDefined();
    expect((skip as any).reason).toBe("no TMUX env");
  });

  it("dryRun mode skips tmux command", async () => {
    process.env.TMUX = "1";
    const { logger, logDir: dir } = makeTestLogger();
    logDir = dir;
    const $ = () => { throw new Error("should not be called"); };
    await updateTmuxTitle({ $, title: "test", dryRun: true, logger });
    await flushLogs();
    const entries = readLogs(logDir);
    const dry = entries.find((e) => e.message === "tmux dry-run");
    expect(dry).toBeDefined();
    expect((dry as any).command).toContain("tmux rename-window");
    delete process.env.TMUX;
  });

  it("executes tmux command when TMUX is set and not dryRun", async () => {
    process.env.TMUX = "1";
    const { logger, logDir: dir } = makeTestLogger();
    logDir = dir;
    let called = false;
    const $ = (strings: TemplateStringsArray, ...values: string[]) => {
      called = true;
      return { quiet: () => Promise.resolve() };
    };
    await updateTmuxTitle({ $, title: "test", dryRun: false, logger });
    expect(called).toBe(true);
    await flushLogs();
    const entries = readLogs(logDir);
    const ok = entries.find((e) => e.message === "tmux ok");
    expect(ok).toBeDefined();
    delete process.env.TMUX;
  });

  it("logs error when tmux command fails", async () => {
    process.env.TMUX = "1";
    const { logger, logDir: dir } = makeTestLogger();
    logDir = dir;
    const tagged$ = Object.assign(
      (strings: TemplateStringsArray, ...values: string[]) => {
        throw new Error("tmux failed");
      },
      { quiet: () => { throw new Error("tmux failed"); } }
    );
    await updateTmuxTitle({ $: tagged$, title: "test", dryRun: false, logger });
    await flushLogs();
    const entries = readLogs(logDir);
    const errEntry = entries.find((e) => e.message === "tmux error");
    expect(errEntry).toBeDefined();
    expect((errEntry as any).error).toContain("tmux failed");
    delete process.env.TMUX;
  });
});

// ── plugin event handling ──

describe("plugin event handling", () => {
  let logDir: string;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      session: {
        get: async () => ({ data: { title: "from-api" } }),
      },
    };
  });

  afterEach(() => {
    delete process.env.TMUX;
    if (logDir) rmSync(logDir, { recursive: true, force: true });
  });

  async function setupPlugin(opts: { debug?: boolean; dryRun?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "opencode-test-"));
    logDir = dir;
    const tmuxCalls: { strings: TemplateStringsArray; values: string[] }[] = [];
    const mock$ = (strings: TemplateStringsArray, ...values: string[]) => {
      tmuxCalls.push({ strings, values });
      return { quiet: () => Promise.resolve() };
    };
    const mod = await import("./index.ts");
    const hooks = await mod.default(
      { client: mockClient, $: mock$, directory: "/tmp", worktree: "/tmp" },
      { debug: opts.debug ?? true, dryRun: opts.dryRun ?? false, logDir: dir },
    );
    return { hooks, tmuxCalls };
  }

  it("session.created updates title", async () => {
    process.env.TMUX = "1";
    const { hooks, tmuxCalls } = await setupPlugin();
    await hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "s1", title: "新会话" } },
      },
    });
    expect(tmuxCalls.length).toBeGreaterThan(0);
    await flushLogs();
    const entries = readLogs(logDir);
    const labelEntry = entries.find((e) => e.message === "label updated");
    expect(labelEntry).toBeDefined();
    expect((labelEntry as any).label).toContain("新会话");
  });

  it("session.updated updates title", async () => {
    process.env.TMUX = "1";
    const { hooks } = await setupPlugin();
    await hooks.event({
      event: {
        type: "session.updated",
        properties: { info: { id: "s1", title: "更新标题" } },
      },
    });
    await flushLogs();
    const entries = readLogs(logDir);
    const labelEntry = entries.find((e) => e.message === "label updated");
    expect(labelEntry).toBeDefined();
    expect((labelEntry as any).label).toContain("更新标题");
  });

  it("session.updated falls back to API when info.title missing", async () => {
    process.env.TMUX = "1";
    const { hooks } = await setupPlugin();
    await hooks.event({
      event: {
        type: "session.updated",
        properties: { info: { id: "s1" } },
      },
    });
    await flushLogs();
    const entries = readLogs(logDir);
    const labelEntry = entries.find((e) => e.message === "label updated");
    expect(labelEntry).toBeDefined();
    expect((labelEntry as any).label).toContain("from-api");
    const apiLog = entries.find((e) => e.message === "title from api");
    expect(apiLog).toBeDefined();
  });

  it("session.status updates status icon", async () => {
    process.env.TMUX = "1";
    const { hooks } = await setupPlugin();
    // first set a title
    await hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "s1", title: "测试" } },
      },
    });
    // then change status
    await hooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: "s1", status: "busy" },
      },
    });
    await flushLogs();
    const entries = readLogs(logDir);
    const labelEntries = entries.filter((e) => e.message === "label updated");
    const lastLabel = labelEntries[labelEntries.length - 1];
    expect(lastLabel).toBeDefined();
    expect((lastLabel as any).label).toContain("●");
    expect((lastLabel as any).status).toBe("busy");
  });

  it("session.deleted clears cache", async () => {
    const { hooks } = await setupPlugin();
    await hooks.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: "s1" } },
      },
    });
    await flushLogs();
    const entries = readLogs(logDir);
    const clearLog = entries.find((e) => e.message === "cache cleared");
    expect(clearLog).toBeDefined();
  });

  it("skips tmux when not in TMUX env", async () => {
    delete process.env.TMUX;
    const { hooks } = await setupPlugin();
    await hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "s1", title: "测试" } },
      },
    });
    await flushLogs();
    const entries = readLogs(logDir);
    const skipLog = entries.find((e) => e.message === "tmux skipped");
    expect(skipLog).toBeDefined();
  });

  it("dryRun mode does not execute tmux", async () => {
    process.env.TMUX = "1";
    const { hooks } = await setupPlugin({ dryRun: true });
    await hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "s1", title: "测试" } },
      },
    });
    await flushLogs();
    const entries = readLogs(logDir);
    const dryRunLog = entries.find((e) => e.message === "tmux dry-run");
    expect(dryRunLog).toBeDefined();
  });
});

// ── logger file output ──

describe("logger file output", () => {
  let logDir: string;

  afterEach(() => {
    if (logDir) rmSync(logDir, { recursive: true, force: true });
  });

  it("creates log file with structured JSON entries", async () => {
    const { logger, logDir: dir } = makeTestLogger(true);
    logDir = dir;
    logger.info("test message", { key: "value" });
    await flushLogs();
    const entries = readLogs(logDir);
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    expect(entry.message).toBe("test message");
    expect((entry as any).key).toBe("value");
    expect(entry.level).toBe("info");
    expect(entry.timestamp).toBeDefined();
  });

  it("debug: false filters out debug messages", async () => {
    const { logger, logDir: dir } = makeTestLogger(false);
    logDir = dir;
    logger.debug("should not appear");
    logger.info("should appear");
    await flushLogs();
    const entries = readLogs(logDir);
    const debugEntry = entries.find((e) => e.message === "should not appear");
    expect(debugEntry).toBeUndefined();
    const infoEntry = entries.find((e) => e.message === "should appear");
    expect(infoEntry).toBeDefined();
  });

  it("debug: true includes debug messages", async () => {
    const { logger, logDir: dir } = makeTestLogger(true);
    logDir = dir;
    logger.debug("debug message");
    await flushLogs();
    const entries = readLogs(logDir);
    const debugEntry = entries.find((e) => e.message === "debug message");
    expect(debugEntry).toBeDefined();
  });

  it("logDir custom path is respected", async () => {
    const customDir = mkdtempSync(join(tmpdir(), "opencode-custom-"));
    const logger = createLogger({ debug: true, logDir: customDir });
    logger.info("custom dir test");
    await flushLogs();
    const entries = readLogs(customDir);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].message).toBe("custom dir test");
    rmSync(customDir, { recursive: true, force: true });
  });
});
