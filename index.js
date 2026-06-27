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
function formatTitle(template, title, status) {
  const icon = STATUS_ICONS[status] ?? "?";
  return template
    .replace(/\{icon\}/g, icon)
    .replace(/\{title\}/g, title)
    .replace(/\{status\}/g, status);
}

/**
 * @param {string} title
 * @returns {Promise<void>}
 */
async function updateTmuxTitle($, title) {
  if (!process.env.TMUX) return;
  try {
    await $`tmux rename-window ${title}`.quiet();
  } catch {
    // tmux command failed — silently ignore
  }
}

/** @type {import("@opencode-ai/plugin").default} */
export default async function plugin(input, options) {
  const template = options?.template || DEFAULT_TEMPLATE;

  /** @type {{ title: string, status: string }} */
  let current = { title: "", status: "idle" };

  return {
    async event({ event }) {
      switch (event.type) {
        case "session.created":
        case "session.updated": {
          const session = event.properties?.info;
          if (!session?.title) return;
          current.title = session.title;
          await updateTmuxTitle(
            input.$,
            formatTitle(template, current.title, current.status),
          );
          break;
        }
        case "session.status": {
          const status = event.properties?.status;
          if (!status || !current.title) return;
          current.status = status;
          await updateTmuxTitle(
            input.$,
            formatTitle(template, current.title, current.status),
          );
          break;
        }
      }
    },
  };
}
