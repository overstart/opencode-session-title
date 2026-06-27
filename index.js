// opencode-session-title: auto-update Tmux window title from OpenCode session state
// ponytail: single-file plugin, split only when >200 lines

const STATUS_ICONS = {
  idle: "○",
  busy: "●",
  retry: "↻",
};

const DEFAULT_TEMPLATE = "[{icon}] {title}";

/**
 * @param {string} template
 * @param {string} title
 * @param {string} status
 * @returns {string}
 */
export function formatTitle(template, title, status) {
  const icon = STATUS_ICONS[status] ?? "?";
  return template
    .replace(/\{icon\}/g, icon)
    .replace(/\{title\}/g, title)
    .replace(/\{status\}/g, status);
}

/**
 * @param {object} opts
 * @param {*} opts.$ - Bun Shell
 * @param {string} opts.title
 * @param {boolean} opts.dryRun
 * @param {(entry: object) => void} opts.log
 * @returns {Promise<void>}
 */
export async function updateTmuxTitle({ $, title, dryRun, log }) {
  if (!process.env.TMUX) {
    log({ tmux: "skipped", reason: "no TMUX env" });
    return;
  }
  if (dryRun) {
    log({ tmux: "dry-run", command: `tmux rename-window ${title}` });
    return;
  }
  try {
    await $`tmux rename-window ${title}`.quiet();
    log({ tmux: "ok", command: `tmux rename-window ${title}` });
  } catch (err) {
    log({ tmux: "error", command: `tmux rename-window ${title}`, error: String(err) });
  }
}

/** @type {import("@opencode-ai/plugin").default} */
export default async function plugin(input, options) {
  const template = options?.template || DEFAULT_TEMPLATE;
  const debug = !!options?.debug;
  const dryRun = !!options?.dryRun;

  /** @type {(entry: object) => void} */
  const log = debug
    ? (entry) => console.error(JSON.stringify({ ts: new Date().toISOString(), ...entry }))
    : () => {};

  /** @type {{ title: string, status: string }} */
  let current = { title: "", status: "idle" };

  return {
    async event({ event }) {
      log({ type: event.type, sessionID: event.properties?.info?.id || event.properties?.sessionID });

      switch (event.type) {
        case "session.created":
        case "session.updated": {
          const session = event.properties?.info;
          if (session?.title) {
            current.title = session.title;
            log({ title: session.title, source: "event" });
          } else if (session?.id) {
            // ponytail: fallback for /sessions switch where info may be incomplete
            try {
              const result = await input.client.session.get({ path: { id: session.id } });
              if (result.data?.title) {
                current.title = result.data.title;
                log({ title: result.data.title, source: "api-fallback" });
              }
            } catch (err) {
              log({ error: "api-fallback-failed", detail: String(err) });
            }
          }
          if (!current.title) return;
          const label = formatTitle(template, current.title, current.status);
          log({ label, status: current.status });
          await updateTmuxTitle({ $: input.$, title: label, dryRun, log });
          break;
        }
        case "session.status": {
          const status = event.properties?.status;
          if (!status || !current.title) return;
          current.status = status;
          const label = formatTitle(template, current.title, current.status);
          log({ label, status: current.status });
          await updateTmuxTitle({ $: input.$, title: label, dryRun, log });
          break;
        }
        case "session.deleted": {
          log({ action: "clear-cache" });
          current.title = "";
          current.status = "idle";
          break;
        }
      }
    },
  };
}
