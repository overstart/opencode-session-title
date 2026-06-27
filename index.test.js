// opencode-session-title unit tests
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { formatTitle, updateTmuxTitle } from "./index.js";

// ── formatTitle ──

describe("formatTitle", () => {
  it("default template with busy status", () => {
    assert.equal(formatTitle("[{icon}] {title}", "修复登录bug", "busy"), "[●] 修复登录bug");
  });

  it("default template with idle status", () => {
    assert.equal(formatTitle("[{icon}] {title}", "测试", "idle"), "[○] 测试");
  });

  it("default template with retry status", () => {
    assert.equal(formatTitle("[{icon}] {title}", "重试中", "retry"), "[↻] 重试中");
  });

  it("custom template {title} [{status}]", () => {
    assert.equal(formatTitle("{title} [{status}]", "测试", "idle"), "测试 [idle]");
  });

  it("custom template {status}: {title}", () => {
    assert.equal(formatTitle("{status}: {title}", "标题", "busy"), "busy: 标题");
  });

  it("unknown status falls back to ?", () => {
    assert.equal(formatTitle("[{icon}] {title}", "测试", "unknown"), "[?] 测试");
  });

  it("empty title", () => {
    assert.equal(formatTitle("[{icon}] {title}", "", "idle"), "[○] ");
  });
});

// ── STATUS_ICONS ──

describe("STATUS_ICONS", () => {
  it("busy → ●", () => {
    assert.equal(formatTitle("{icon}", "", "busy"), "●");
  });

  it("idle → ○", () => {
    assert.equal(formatTitle("{icon}", "", "idle"), "○");
  });

  it("retry → ↻", () => {
    assert.equal(formatTitle("{icon}", "", "retry"), "↻");
  });
});

// ── updateTmuxTitle ──

describe("updateTmuxTitle", () => {
  let logs = [];

  beforeEach(() => {
    logs = [];
  });

  it("skips when TMUX env is not set", async () => {
    delete process.env.TMUX;
    const $ = () => { throw new Error("should not be called"); };
    await updateTmuxTitle({ $, title: "test", dryRun: false, log: (e) => logs.push(e) });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].tmux, "skipped");
  });

  it("dryRun mode skips tmux command", async () => {
    process.env.TMUX = "1";
    const $ = () => { throw new Error("should not be called"); };
    await updateTmuxTitle({ $, title: "test", dryRun: true, log: (e) => logs.push(e) });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].tmux, "dry-run");
    assert.ok(logs[0].command.includes("tmux rename-window"));
    delete process.env.TMUX;
  });

  it("executes tmux command when TMUX is set and not dryRun", async () => {
    process.env.TMUX = "1";
    let called = false;
    const $ = (strings, ...values) => {
      called = true;
      return { quiet: () => Promise.resolve() };
    };
    await updateTmuxTitle({ $, title: "test", dryRun: false, log: (e) => logs.push(e) });
    assert.ok(called);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].tmux, "ok");
    delete process.env.TMUX;
  });

  it("logs error when tmux command fails", async () => {
    process.env.TMUX = "1";
    const $ = () => {
      const err = new Error("tmux failed");
      throw err;
    };
    // Bun Shell tagged template — need to match the call pattern
    const tagged$ = Object.assign(
      (strings, ...values) => {
        const err = new Error("tmux failed");
        throw err;
      },
      { quiet: () => { throw new Error("tmux failed"); } }
    );
    await updateTmuxTitle({ $: tagged$, title: "test", dryRun: false, log: (e) => logs.push(e) });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].tmux, "error");
    assert.ok(logs[0].error.includes("tmux failed"));
    delete process.env.TMUX;
  });
});

// ── plugin event handling ──

describe("plugin event handling", () => {
  /** @type {import("./index.js").default} */
  let hooks;
  let logs;
  let tmuxCalls;
  let mockClient;

  beforeEach(async () => {
    logs = [];
    tmuxCalls = [];
    mockClient = {
      session: {
        get: async () => ({ data: { title: "from-api" } }),
      },
    };
    const mock$ = (strings, ...values) => {
      tmuxCalls.push({ strings, values });
      return { quiet: () => Promise.resolve() };
    };
    const mod = await import("./index.js");
    const hooksObj = await mod.default(
      { client: mockClient, $: mock$, directory: "/tmp", worktree: "/tmp" },
      { debug: true },
    );
    // wrap event handler to capture logs
    const origEventHandler = hooksObj.event;
    hooks = {
      event: async (input) => {
        const origError = console.error;
        console.error = (...args) => logs.push(JSON.parse(args[0]));
        try {
          await origEventHandler(input);
        } finally {
          console.error = origError;
        }
      },
    };
  });

  afterEach(() => {
    delete process.env.TMUX;
  });

  it("session.created updates title", async () => {
    process.env.TMUX = "1";
    await hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "s1", title: "新会话" } },
      },
    });
    assert.ok(tmuxCalls.length > 0);
    const logEntries = logs.filter((e) => e.label);
    assert.ok(logEntries.length > 0);
    assert.ok(logEntries[0].label.includes("新会话"));
  });

  it("session.updated updates title", async () => {
    process.env.TMUX = "1";
    await hooks.event({
      event: {
        type: "session.updated",
        properties: { info: { id: "s1", title: "更新标题" } },
      },
    });
    const logEntries = logs.filter((e) => e.label);
    assert.ok(logEntries.length > 0);
    assert.ok(logEntries[0].label.includes("更新标题"));
  });

  it("session.updated falls back to API when info.title missing", async () => {
    process.env.TMUX = "1";
    await hooks.event({
      event: {
        type: "session.updated",
        properties: { info: { id: "s1" } },
      },
    });
    const logEntries = logs.filter((e) => e.label);
    assert.ok(logEntries.length > 0);
    assert.ok(logEntries[0].label.includes("from-api"));
    const sourceLog = logs.find((e) => e.source === "api-fallback");
    assert.ok(sourceLog);
  });

  it("session.status updates status icon", async () => {
    process.env.TMUX = "1";
    // first set a title
    await hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "s1", title: "测试" } },
      },
    });
    tmuxCalls = [];
    logs = [];
    // then change status
    await hooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: "s1", status: "busy" },
      },
    });
    const labelLog = logs.find((e) => e.label);
    assert.ok(labelLog);
    assert.ok(labelLog.label.includes("●"));
    assert.equal(labelLog.status, "busy");
  });

  it("session.deleted clears cache", async () => {
    await hooks.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: "s1" } },
      },
    });
    const clearLog = logs.find((e) => e.action === "clear-cache");
    assert.ok(clearLog);
  });

  it("skips tmux when not in TMUX env", async () => {
    delete process.env.TMUX;
    await hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "s1", title: "测试" } },
      },
    });
    const skipLog = logs.find((e) => e.tmux === "skipped");
    assert.ok(skipLog);
  });

  it("dryRun mode does not execute tmux", async () => {
    process.env.TMUX = "1";
    const mod = await import("./index.js");
    const hooks = await mod.default(
      { client: mockClient, $: () => { throw new Error("should not exec"); }, directory: "/tmp", worktree: "/tmp" },
      { dryRun: true, debug: true },
    );
    let dryLogs = [];
    const origError = console.error;
    console.error = (...args) => dryLogs.push(JSON.parse(args[0]));
    try {
      await hooks.event({
        event: {
          type: "session.created",
          properties: { info: { id: "s1", title: "测试" } },
        },
      });
    } finally {
      console.error = origError;
    }
    const dryRunLog = dryLogs.find((e) => e.tmux === "dry-run");
    assert.ok(dryRunLog);
  });
});
