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

export async function resolveTargetWindow(opts: {
  $: any;
  logger: winston.Logger;
}): Promise<string | undefined> {
  const { $, logger } = opts;
  if (!process.env.TMUX_PANE) return undefined;
  try {
    const result = await $`tmux display-message -p -t "$TMUX_PANE" -F '#{window_id}'`.quiet();
    const windowId = result.stdout?.toString().trim();
    if (windowId) {
      logger.info("target window resolved", { windowId });
      return windowId;
    }
  } catch (err) {
    logger.warn("target window resolve failed, falling back to current window", { error: String(err) });
  }
  return undefined;
}

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
  maxLength?: number;
  targetWindow?: string;
  dryRun: boolean;
  logger: winston.Logger;
}): Promise<void> {
  const { $, title, maxLength, targetWindow, dryRun, logger } = opts;

  if (!process.env.TMUX) {
    logger.info("tmux skipped", { reason: "no TMUX env" });
    return;
  }

  const displayTitle = maxLength && title.length > maxLength
    ? title.slice(0, maxLength) + "…"
    : title;

  const targetFlag = targetWindow ? `-t ${targetWindow}` : "";

  if (dryRun) {
    logger.info("tmux dry-run", { command: `tmux rename-window ${targetFlag} ${displayTitle}`.trim() });
    return;
  }
  try {
    if (targetWindow) {
      await $`tmux rename-window -t ${targetWindow} ${displayTitle}`.quiet();
    } else {
      await $`tmux rename-window ${displayTitle}`.quiet();
    }
    // ponytail: store full title in window option for hover/click display
    if (maxLength) {
      if (targetWindow) {
        await $`tmux set-window-option -t ${targetWindow} @opencode_title_full ${title}`.quiet();
      } else {
        await $`tmux set-window-option @opencode_title_full ${title}`.quiet();
      }
    }
    logger.info("tmux ok", { command: `tmux rename-window ${targetFlag} ${displayTitle}`.trim() });
  } catch (err) {
    logger.error("tmux error", { command: `tmux rename-window ${targetFlag} ${displayTitle}`.trim(), error: String(err) });
  }
}

export default async function plugin(input: any, options: PluginOptions = {}) {
  const template = options.template || DEFAULT_TEMPLATE;
  const maxLength = options.maxLength;
  const debug = !!options.debug;
  const dryRun = !!options.dryRun;

  const logger = createLogger({ debug, logDir: options.logDir, testMode: options.testMode });

  const targetWindow = await resolveTargetWindow({ $: input.$, logger });

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
          await updateTmuxTitle({ $: input.$, title: label, maxLength, targetWindow, dryRun, logger });
          break;
        }
        case "session.status": {
          // ponytail: OpenCode sends status as { type: "busy" }, not plain string
          const statusObj = event.properties?.status as { type: string } | undefined;
          if (!statusObj?.type || !current.title) return;
          current.status = statusObj.type as SessionStatus;
          const label = formatTitle(template, current.title, current.status);
          logger.debug("label updated", { label, status: current.status });
          await updateTmuxTitle({ $: input.$, title: label, maxLength, targetWindow, dryRun, logger });
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
