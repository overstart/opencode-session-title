// opencode-session-title: auto-update Tmux window title from OpenCode session state
// ponytail: single-file plugin core, split only when >200 lines

import type { SessionStatus, PluginOptions, CurrentState } from "./types.js";
import { createLogger } from "./logger.js";
import type winston from "winston";

const STATUS_ICONS: Record<SessionStatus, string> = {
  idle: "○",
  busy: "●",
  retry: "↻",
};

const DEFAULT_TEMPLATE = "[{icon}] {title}";

export function formatTitle(template: string, title: string, status: string): string {
  const icon = STATUS_ICONS[status as SessionStatus] ?? "?";
  return template
    .replace(/\{icon\}/g, icon)
    .replace(/\{title\}/g, title)
    .replace(/\{status\}/g, status);
}

export async function updateTmuxTitle(opts: {
  $: any;
  title: string;
  dryRun: boolean;
  logger: winston.Logger;
}): Promise<void> {
  const { $, title, dryRun, logger } = opts;

  if (!process.env.TMUX) {
    logger.info("tmux skipped", { reason: "no TMUX env" });
    return;
  }
  if (dryRun) {
    logger.info("tmux dry-run", { command: `tmux rename-window ${title}` });
    return;
  }
  try {
    await $`tmux rename-window ${title}`.quiet();
    logger.info("tmux ok", { command: `tmux rename-window ${title}` });
  } catch (err) {
    logger.error("tmux error", { command: `tmux rename-window ${title}`, error: String(err) });
  }
}

/** @type {import("@opencode-ai/plugin").default} */
export default async function plugin(input: any, options: PluginOptions = {}) {
  const template = options.template || DEFAULT_TEMPLATE;
  const debug = !!options.debug;
  const dryRun = !!options.dryRun;

  const logger = createLogger({ debug, logDir: options.logDir });

  const current: CurrentState = { title: "", status: "idle" };

  return {
    async event({ event }: { event: any }) {
      logger.debug("event received", {
        type: event.type,
        sessionID: event.properties?.info?.id || event.properties?.sessionID,
      });

      switch (event.type) {
        case "session.created":
        case "session.updated": {
          const session = event.properties?.info;
          if (session?.title) {
            current.title = session.title;
            logger.debug("title from event", { title: session.title });
          } else if (session?.id) {
            // ponytail: fallback for /sessions switch where info may be incomplete
            try {
              const result = await input.client.session.get({ path: { id: session.id } });
              if (result.data?.title) {
                current.title = result.data.title;
                logger.debug("title from api", { title: result.data.title });
              }
            } catch (err) {
              logger.error("api fallback failed", { detail: String(err) });
            }
          }
          if (!current.title) return;
          const label = formatTitle(template, current.title, current.status);
          logger.debug("label updated", { label, status: current.status });
          await updateTmuxTitle({ $: input.$, title: label, dryRun, logger });
          break;
        }
        case "session.status": {
          const status = event.properties?.status as SessionStatus | undefined;
          if (!status || !current.title) return;
          current.status = status;
          const label = formatTitle(template, current.title, current.status);
          logger.debug("label updated", { label, status: current.status });
          await updateTmuxTitle({ $: input.$, title: label, dryRun, logger });
          break;
        }
        case "session.deleted": {
          logger.debug("cache cleared");
          current.title = "";
          current.status = "idle";
          break;
        }
      }
    },
  };
}
