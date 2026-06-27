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
  const logger = createLogger({ debug, logDir, testMode: true });
  return { logger, logDir };
}

function readLogs(logDir: string): Record<string, unknown>[] {
  // ponytail: only read test log files (testMode uses -test.log suffix)
  let files: string[];
  try {
    files = readdirSync(logDir).filter((f: string) => f.endsWith(".log"));
  } catch {
    return [];
  }
  const entries: Record<string, unknown>[] = [];
  for (const f of files) {
    try {
      const content = readFileSync(join(logDir, f), "utf-8").trim();
      if (!content) continue;
      for (const line of content.split("\n")) {
        try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    } catch { /* file may not be flushed yet */ }
  }
  return entries;
}

// ponytail: poll for log file content until it appears
function flushLogs(logDir: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      let files: string[] = [];
      try { files = readdirSync(logDir).filter((f: string) => f.endsWith(".log")); } catch { /* dir gone */ }
      for (const f of files) {
        try {
          const content = readFileSync(join(logDir, f), "utf-8").trim();
          if (content) { resolve(); return; }
        } catch { /* race */ }
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`flushLogs timeout for ${logDir}`));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
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
    await flushLogs(logDir);
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
    await flushLogs(logDir);
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
    await flushLogs(logDir);
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
    await flushLogs(logDir);
    const entries = readLogs(logDir);
    const errEntry = entries.find((e) => e.message === "tmux error");
    expect(errEntry).toBeDefined();
    expect((errEntry as any).error).toContain("tmux failed");
    delete process.env.TMUX;
  });

  it("truncates title with maxLength", async () => {
    process.env.TMUX = "1";
    const { logger, logDir: dir } = makeTestLogger();
    logDir = dir;
    const calls: string[] = [];
    const $ = (strings: TemplateStringsArray, ...values: string[]) => {
      const cmd = String.raw({ raw: strings }, ...values);
      calls.push(cmd);
      return { quiet: () => Promise.resolve() };
    };
    await updateTmuxTitle({ $, title: "[●] 修复登录页面的按钮样式问题", maxLength: 10, dryRun: false, logger });
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("rename-window");
    expect(calls[0]).toContain("[●] 修复登录页面…");
    expect(calls[1]).toContain("set-window-option @opencode_title_full");
    expect(calls[1]).toContain("[●] 修复登录页面的按钮样式问题");
    delete process.env.TMUX;
  });

  it("no truncation when title fits maxLength", async () => {
    process.env.TMUX = "1";
    const { logger, logDir: dir } = makeTestLogger();
    logDir = dir;
    const calls: string[] = [];
    const $ = (strings: TemplateStringsArray, ...values: string[]) => {
      const cmd = String.raw({ raw: strings }, ...values);
      calls.push(cmd);
      return { quiet: () => Promise.resolve() };
    };
    await updateTmuxTitle({ $, title: "[○] 短标题", maxLength: 10, dryRun: false, logger });
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("[○] 短标题"); // no truncation, no "…"
    expect(calls[1]).toContain("set-window-option @opencode_title_full");
    delete process.env.TMUX;
  });

  it("no window option when maxLength not set", async () => {
    process.env.TMUX = "1";
    const { logger, logDir: dir } = makeTestLogger();
    logDir = dir;
    const calls: string[] = [];
    const $ = (strings: TemplateStringsArray, ...values: string[]) => {
      const cmd = String.raw({ raw: strings }, ...values);
      calls.push(cmd);
      return { quiet: () => Promise.resolve() };
    };
    await updateTmuxTitle({ $, title: "[●] 修复登录页面的按钮样式问题", dryRun: false, logger });
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("rename-window");
    expect(calls[0]).toContain("[●] 修复登录页面的按钮样式问题");
    delete process.env.TMUX;
  });

  it("uses -t flag when targetWindow is set", async () => {
    process.env.TMUX = "1";
    const { logger, logDir: dir } = makeTestLogger();
    logDir = dir;
    const calls: string[] = [];
    const $ = (strings: TemplateStringsArray, ...values: string[]) => {
      const cmd = String.raw({ raw: strings }, ...values);
      calls.push(cmd);
      return { quiet: () => Promise.resolve() };
    };
    await updateTmuxTitle({ $, title: "test", targetWindow: "@0", dryRun: false, logger });
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("rename-window -t @0 test");
    delete process.env.TMUX;
  });

  it("no -t flag when targetWindow is undefined", async () => {
    process.env.TMUX = "1";
    const { logger, logDir: dir } = makeTestLogger();
    logDir = dir;
    const calls: string[] = [];
    const $ = (strings: TemplateStringsArray, ...values: string[]) => {
      const cmd = String.raw({ raw: strings }, ...values);
      calls.push(cmd);
      return { quiet: () => Promise.resolve() };
    };
    await updateTmuxTitle({ $, title: "test", dryRun: false, logger });
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe("tmux rename-window test");
    delete process.env.TMUX;
  });

  it("set-window-option uses -t when targetWindow and maxLength are set", async () => {
    process.env.TMUX = "1";
    const { logger, logDir: dir } = makeTestLogger();
    logDir = dir;
    const calls: string[] = [];
    const $ = (strings: TemplateStringsArray, ...values: string[]) => {
      const cmd = String.raw({ raw: strings }, ...values);
      calls.push(cmd);
      return { quiet: () => Promise.resolve() };
    };
    await updateTmuxTitle({ $, title: "[●] 长标题超过限制需要截断", maxLength: 10, targetWindow: "@1", dryRun: false, logger });
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("rename-window -t @1");
    expect(calls[0]).toContain("[●] 长标题超过限…");
    expect(calls[1]).toContain("set-window-option -t @1 @opencode_title_full");
    expect(calls[1]).toContain("[●] 长标题超过限制需要截断");
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

  async function setupPlugin(opts: { debug?: boolean; dryRun?: boolean; maxLength?: number } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "opencode-test-"));
    logDir = dir;
    const tmuxCalls: { strings: TemplateStringsArray; values: string[] }[] = [];
    const mock$ = (strings: TemplateStringsArray, ...values: string[]) => {
      tmuxCalls.push({ strings, values });
      const result = { stdout: Buffer.from("@0") } as any;
      result.quiet = () => Promise.resolve(result);
      return result;
    };
    const mod = await import("./index.ts");
    const hooks = await mod.default(
      { client: mockClient, $: mock$, directory: "/tmp", worktree: "/tmp" },
      { debug: opts.debug ?? true, dryRun: opts.dryRun ?? false, maxLength: opts.maxLength, logDir: dir, testMode: true },
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
    await flushLogs(logDir);
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
    await flushLogs(logDir);
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
    await flushLogs(logDir);
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
        properties: { sessionID: "s1", status: { type: "busy" } },
      },
    });
    await flushLogs(logDir);
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
    await flushLogs(logDir);
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
    await flushLogs(logDir);
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
    await flushLogs(logDir);
    const entries = readLogs(logDir);
    const dryRunLog = entries.find((e) => e.message === "tmux dry-run");
    expect(dryRunLog).toBeDefined();
  });

  it("truncates title with maxLength option", async () => {
    process.env.TMUX = "1";
    process.env.TMUX_PANE = "%0";
    const { hooks, tmuxCalls } = await setupPlugin({ maxLength: 10 });
    await hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "s1", title: "修复登录页面的按钮样式问题" } },
      },
    });
    // resolveTargetWindow + rename-window + set-window-option = 3 calls
    expect(tmuxCalls.length).toBe(3);
    const renameCmd = String.raw({ raw: tmuxCalls[1].strings }, ...tmuxCalls[1].values);
    expect(renameCmd).toContain("[○] 修复登录页面…");
    const optCmd = String.raw({ raw: tmuxCalls[2].strings }, ...tmuxCalls[2].values);
    expect(optCmd).toContain("set-window-option -t @0 @opencode_title_full");
    expect(optCmd).toContain("[○] 修复登录页面的按钮样式问题");
    delete process.env.TMUX;
    delete process.env.TMUX_PANE;
  });

  it("uses -t flag when TMUX_PANE is set", async () => {
    process.env.TMUX = "1";
    process.env.TMUX_PANE = "%0";
    const { hooks, tmuxCalls } = await setupPlugin();
    await hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "s1", title: "测试" } },
      },
    });
    // resolveTargetWindow + rename-window = 2 calls
    expect(tmuxCalls.length).toBe(2);
    const renameCmd = String.raw({ raw: tmuxCalls[1].strings }, ...tmuxCalls[1].values);
    expect(renameCmd).toContain("rename-window -t @0");
    expect(renameCmd).toContain("[○] 测试");
    delete process.env.TMUX;
    delete process.env.TMUX_PANE;
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
    await flushLogs(logDir);
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
    await flushLogs(logDir);
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
    await flushLogs(logDir);
    const entries = readLogs(logDir);
    const debugEntry = entries.find((e) => e.message === "debug message");
    expect(debugEntry).toBeDefined();
  });

  it("logDir custom path is respected", async () => {
    const customDir = mkdtempSync(join(tmpdir(), "opencode-custom-"));
    const logger = createLogger({ debug: true, logDir: customDir, testMode: true });
    logger.info("custom dir test");
    await flushLogs(customDir);
    const entries = readLogs(customDir);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].message).toBe("custom dir test");
    rmSync(customDir, { recursive: true, force: true });
  });
});
