import { loadConfig } from "../config/config.js";
import { danger, info, logVerbose } from "../globals.js";
import { getChildLogger } from "../logging.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { createAndLoginDiscordClient, resolveDiscordConfig } from "./client.js";
import { registerDiscordHandlers } from "./events.js";
import {
  resolveDiscordHeartbeatSeconds,
  runDiscordHeartbeatOnce,
} from "./heartbeat.js";
import type { DiscordMonitorOptions } from "./types.js";

export {
  createAndLoginDiscordClient,
  createDiscordClient,
  resolveDiscordConfig,
} from "./client.js";
export {
  resolveDiscordHeartbeatSeconds,
  runDiscordHeartbeatOnce,
} from "./heartbeat.js";
export { sendDiscordMessage, sendDiscordReply } from "./send.js";
export type * from "./types.js";

export async function monitorDiscordProvider(
  options: Partial<DiscordMonitorOptions> = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const verbose = options.verbose ?? false;
  const logger = getChildLogger({ module: "discord-relay" });
  const cfg = loadConfig();
  const config = resolveDiscordConfig(cfg);

  if (verbose) {
    logVerbose("Discord config resolved:");
    logVerbose(`  botToken: ${config.botToken.slice(0, 6)}...`);
    logVerbose(`  mentionOnly: ${config.mentionOnly}`);
    logVerbose(`  replyInThread: ${config.replyInThread}`);
    logVerbose(
      `  allow users/channels/guilds: ${config.allowedUsers.length}/${config.allowedChannels.length}/${config.allowedGuilds.length}`,
    );
    logVerbose(
      `  heartbeat: user=${config.heartbeatUserId ?? "disabled"}, seconds=${config.heartbeatSeconds ?? "default"}`,
    );
  }

  try {
    runtime.log(info("Connecting to Discord..."));
    const { client, botUserId, botTag } =
      await createAndLoginDiscordClient(config);
    runtime.log(info(`✅ Logged in as ${botTag}`));
    logger.info({ botUserId, botTag }, "Discord client logged in");

    registerDiscordHandlers(client, botUserId, config);
    const heartbeatSeconds = resolveDiscordHeartbeatSeconds(
      config,
      options.heartbeatSeconds,
    );
    const heartbeatUserId = config.heartbeatUserId;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let heartbeatInFlight = false;

    const runHeartbeat = async (reason: string) => {
      if (!heartbeatUserId) return;
      if (heartbeatInFlight) {
        logger.debug({ reason }, "discord heartbeat already in flight");
        return;
      }
      heartbeatInFlight = true;
      try {
        await runDiscordHeartbeatOnce({
          client,
          botUserId,
          userId: heartbeatUserId,
          config,
          cfg,
          verbose,
          runtime,
        });
      } catch (err) {
        logger.warn(
          { error: String(err), reason },
          "discord heartbeat failed",
        );
      } finally {
        heartbeatInFlight = false;
      }
    };

    if (heartbeatSeconds && heartbeatUserId) {
      runtime.log(
        info(
          `Discord heartbeat enabled: DM ${heartbeatUserId} every ${heartbeatSeconds}s`,
        ),
      );
      if (options.heartbeatNow) {
        void runHeartbeat("startup");
      }
      heartbeatTimer = setInterval(() => {
        void runHeartbeat("interval");
      }, heartbeatSeconds * 1000);
    } else if (options.heartbeatSeconds || config.heartbeatSeconds) {
      runtime.log(
        danger(
          "Discord heartbeat not started: set discord.heartbeatUserId in your config to enable DM heartbeats.",
        ),
      );
    }

    const shutdown = async () => {
      runtime.log(info("Shutting down Discord relay..."));
      logger.info("Discord relay shutting down");
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      client.destroy();
      runtime.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        void shutdown();
      });
    }

    runtime.log(
      info(
        `📡 Listening for Discord messages. MentionOnly=${config.mentionOnly}. Ctrl+C to exit.`,
      ),
    );

    await new Promise(() => {
      /* keep alive */
    });
  } catch (err) {
    logger.error({ error: String(err) }, "Discord provider failed");
    runtime.error(danger(`Discord relay failed: ${String(err)}`));
    runtime.exit(1);
  }
}
