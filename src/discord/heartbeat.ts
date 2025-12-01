import { getReplyFromConfig } from "../auto-reply/reply.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { loadConfig, type WarelayConfig } from "../config/config.js";
import {
  DEFAULT_IDLE_MINUTES,
  deriveSessionKey,
  loadSessionStore,
  resolveStorePath,
  saveSessionStore,
} from "../config/sessions.js";
import { resolveProfilePaths } from "../config/runtime.js";
import { danger, success } from "../globals.js";
import { getChildLogger } from "../logging.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { HEARTBEAT_PROMPT, stripHeartbeatToken } from "../web/auto-reply.js";
import { sendDiscordMessage, type SendableChannel } from "./send.js";
import { resolveDiscordConfig } from "./client.js";
import type { DiscordRuntimeConfig } from "./types.js";

export const DEFAULT_DISCORD_HEARTBEAT_SECONDS = 60;

type DiscordDmChannel = SendableChannel & {
  sendTyping?: () => Promise<void>;
};

type DiscordUserLike = {
  id: string;
  createDM: () => Promise<DiscordDmChannel>;
};

type DiscordClientLike = {
  users: {
    fetch: (id: string) => Promise<DiscordUserLike>;
  };
};

function resolveHeartbeatSeconds(
  config: DiscordRuntimeConfig,
  overrideSeconds?: number,
): number | null {
  const candidate = overrideSeconds ?? config.heartbeatSeconds;
  if (typeof candidate === "number" && candidate > 0) return candidate;
  if (config.heartbeatUserId) return DEFAULT_DISCORD_HEARTBEAT_SECONDS;
  return null;
}

function snapshotSession(cfg: WarelayConfig, from: string) {
  const sessionCfg = cfg.inbound?.reply?.session;
  if (!sessionCfg) return null;
  const scope = sessionCfg.scope ?? "per-sender";
  const key = deriveSessionKey(scope, { From: from, To: "", Body: "" });
  const storePath = resolveStorePath(sessionCfg.store);
  const store = loadSessionStore(storePath);
  const entry = store[key];
  const idleMinutes = Math.max(
    (
      sessionCfg.heartbeatIdleMinutes ??
      sessionCfg.idleMinutes ??
      DEFAULT_IDLE_MINUTES
    ),
    1,
  );
  return { key, entry, idleMinutes, storePath };
}

function buildCtx(
  userId: string,
  botUserId: string,
  discordCfg: DiscordRuntimeConfig,
) {
  const { profileLabel } = resolveProfilePaths();
  const sentAtIso = new Date().toISOString();
  return {
    Body: HEARTBEAT_PROMPT,
    From: userId,
    To: userId,
    provider: "discord",
    assistantProfile: profileLabel,
    assistantLabel: discordCfg.assistantLabel,
    assistantPersona: discordCfg.assistantPersona,
    botUserId,
    senderId: userId,
    senderName: userId,
    channelId: userId,
    sentAtIso,
    promptPrefix: `[discord heartbeat] at ${sentAtIso}:\n`,
  };
}

async function deliverReply(
  channel: DiscordDmChannel,
  reply: ReplyPayload,
  logger: ReturnType<typeof getChildLogger>,
) {
  const mediaList = reply.mediaUrls?.length
    ? reply.mediaUrls
    : reply.mediaUrl
      ? [reply.mediaUrl]
      : [];
  const text = reply.text ?? "";
  const results = await sendDiscordMessage(channel, text, mediaList);
  const first = results.at(0);
  logger.info(
    {
      replyChars: text.length,
      hasMedia: mediaList.length > 0,
      messageId: first?.messageId ?? null,
    },
    "discord heartbeat sent",
  );
  const summary = first?.messageId
    ? `discord heartbeat sent (message ${first.messageId})`
    : "discord heartbeat sent";
  console.log(success(summary));
}

export function resolveDiscordHeartbeatSeconds(
  config: DiscordRuntimeConfig,
  overrideSeconds?: number,
): number | null {
  return resolveHeartbeatSeconds(config, overrideSeconds);
}

export async function runDiscordHeartbeatOnce(opts: {
  client: DiscordClientLike;
  botUserId: string;
  userId: string;
  config?: DiscordRuntimeConfig;
  cfg?: WarelayConfig;
  verbose?: boolean;
  runtime?: RuntimeEnv;
  replyResolver?: typeof getReplyFromConfig;
  overrideBody?: string;
  dryRun?: boolean;
}) {
  const {
    client,
    botUserId,
    userId,
    config: configOverride,
    cfg: cfgOverride,
    verbose = false,
    overrideBody,
    dryRun = false,
  } = opts;
  const runtime = opts.runtime ?? defaultRuntime;
  const cfg = cfgOverride ?? loadConfig();
  const discordCfg = configOverride ?? resolveDiscordConfig(cfg);
  const logger = getChildLogger({
    module: "discord-heartbeat",
    userId,
  });

  if (overrideBody && overrideBody.trim().length === 0) {
    throw new Error("Override body must be non-empty when provided.");
  }

  const user = await client.users.fetch(userId);
  const dmChannel = await user.createDM();

  const startTyping = async () => {
    try {
      if (typeof dmChannel.sendTyping === "function") {
        await dmChannel.sendTyping();
      }
    } catch {
      // typing failures are non-fatal
    }
  };

  if (overrideBody) {
    if (dryRun) {
      console.log(
        success(
          `[dry-run] discord send -> ${userId}: ${overrideBody.trim()} (manual message)`,
        ),
      );
      return;
    }
    await deliverReply(
      dmChannel,
      { text: overrideBody.trim() },
      logger.child({ reason: "manual-message" }),
    );
    return;
  }

  const sessionSnapshot = snapshotSession(cfg, userId);
  const ctx = buildCtx(userId, botUserId, discordCfg);
  const replyResolver = opts.replyResolver ?? getReplyFromConfig;

  try {
    const reply = await replyResolver(ctx, { onReplyStart: startTyping }, cfg);
    if (
      !reply ||
      (!reply.text &&
        !reply.mediaUrl &&
        (reply.mediaUrls?.length ?? 0) === 0)
    ) {
      logger.info({ reason: "empty-reply" }, "discord heartbeat skipped");
      if (verbose) console.log(success("discord heartbeat: ok (empty reply)"));
      return;
    }

    const hasMedia = Boolean(
      reply.mediaUrl || (reply.mediaUrls?.length ?? 0) > 0,
    );
    const stripped = stripHeartbeatToken(reply.text);
    if (stripped.shouldSkip && !hasMedia) {
      if (sessionSnapshot?.entry) {
        const store = loadSessionStore(sessionSnapshot.storePath);
        if (store[sessionSnapshot.key]) {
          store[sessionSnapshot.key].updatedAt =
            sessionSnapshot.entry.updatedAt;
          await saveSessionStore(sessionSnapshot.storePath, store);
        }
      }
      logger.info(
        { reason: "heartbeat-token", rawLength: reply.text?.length ?? 0 },
        "discord heartbeat skipped",
      );
      console.log(success("discord heartbeat: ok (HEARTBEAT_OK)"));
      return;
    }

    const text = stripped.text || reply.text || "";
    if (dryRun) {
      console.log(
        success(
          `[dry-run] discord heartbeat -> ${userId}: ${text.slice(0, 200)}`,
        ),
      );
      return;
    }

    await deliverReply(dmChannel, { ...reply, text }, logger);
  } catch (err) {
    logger.error({ error: String(err) }, "discord heartbeat failed");
    runtime.error(danger(`Discord heartbeat failed: ${String(err)}`));
  }
}
