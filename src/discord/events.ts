import { ChannelType, type Client, type Message } from "discord.js";

import { getReplyFromConfig } from "../auto-reply/reply.js";
import type { MsgContext } from "../auto-reply/templating.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { loadConfig } from "../config/config.js";
import { danger, info, isVerbose, logVerbose, success } from "../globals.js";
import { getChildLogger } from "../logging.js";
import { sendDiscordReply } from "./send.js";
import type {
  DiscordRuntimeConfig,
  NormalizedDiscordMessage,
} from "./types.js";

export function stripBotMention(content: string, botUserId: string): string {
  const mentionPatterns = [
    new RegExp(`<@${botUserId}>`, "g"),
    new RegExp(`<@!${botUserId}>`, "g"),
  ];
  let cleaned = content;
  for (const re of mentionPatterns) {
    cleaned = cleaned.replace(re, "");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

export function normalizeMessage(
  message: Message,
  botUserId: string,
  config: DiscordRuntimeConfig,
): NormalizedDiscordMessage | null {
  if (!botUserId) return null;
  if (message.author.bot) return null;
  if (!message.content && message.attachments.size === 0) return null;

  const isDM = message.channel.type === ChannelType.DM;
  const isMention = isDM ? true : message.mentions.has(botUserId);
  const isThread =
    "isThread" in message.channel &&
    typeof (message.channel as { isThread?: () => boolean }).isThread ===
      "function" &&
    (message.channel as { isThread?: () => boolean }).isThread?.() === true;

  if (!isDM && config.mentionOnly && !isMention) {
    if (isVerbose()) {
      logVerbose("Discord: ignoring message without mention in channel.");
    }
    return null;
  }

  const userId = message.author.id;
  const channelId = message.channelId;
  const guildId = message.guildId ?? null;

  if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(userId)) {
    if (isVerbose()) {
      logVerbose(`Discord: ignoring non-allowed user ${userId}`);
    }
    return null;
  }

  if (
    config.allowedChannels.length > 0 &&
    !config.allowedChannels.includes(channelId)
  ) {
    if (isVerbose()) {
      logVerbose(`Discord: ignoring non-allowed channel ${channelId}`);
    }
    return null;
  }

  if (
    guildId &&
    config.allowedGuilds.length > 0 &&
    !config.allowedGuilds.includes(guildId)
  ) {
    if (isVerbose()) {
      logVerbose(`Discord: ignoring non-allowed guild ${guildId}`);
    }
    return null;
  }

  let content = message.content ?? "";
  if (!isDM && isMention) {
    content = stripBotMention(content, botUserId);
  }

  return {
    userId,
    userTag: message.author.tag,
    channelId,
    guildId,
    messageId: message.id,
    content,
    isDM,
    isMention,
    isThread,
    threadId: isThread ? channelId : null,
    timestamp: message.createdAt,
    rawMessage: message,
  };
}

export function toMsgContext(msg: NormalizedDiscordMessage): MsgContext {
  return {
    Body: msg.content,
    From: msg.userId,
    To: msg.channelId,
    MessageSid: msg.messageId,
  };
}

async function sendReply(
  message: Message,
  reply: ReplyPayload,
  config: DiscordRuntimeConfig,
) {
  await sendDiscordReply(message, reply, {
    replyInThread: config.replyInThread,
  });
}

export async function handleDiscordMessage(
  message: Message,
  botUserId: string,
  config: DiscordRuntimeConfig,
): Promise<void> {
  const logger = getChildLogger({ module: "discord-events" });
  const normalized = normalizeMessage(message, botUserId, config);
  if (!normalized) return;

  const ctx = toMsgContext(normalized);
  const cfg = loadConfig();

  logger.info(
    {
      userId: normalized.userId,
      channelId: normalized.channelId,
      guildId: normalized.guildId,
      isDM: normalized.isDM,
    },
    "Discord inbound message",
  );

  const source = normalized.isDM ? "DM" : `channel ${normalized.channelId}`;
  if (isVerbose()) {
    logVerbose(
      `[Discord inbound] ${source} ${normalized.userTag}: ${normalized.content}`,
    );
  }

  const startTyping = async () => {
    try {
      if (
        "sendTyping" in message.channel &&
        typeof message.channel.sendTyping === "function"
      ) {
        await message.channel.sendTyping();
      }
    } catch {
      // Ignore typing failures.
    }
  };

  try {
    const reply = await getReplyFromConfig(
      ctx,
      { onReplyStart: startTyping },
      cfg,
    );
    if (
      !reply ||
      (!reply.text && !reply.mediaUrl && (reply.mediaUrls?.length ?? 0) === 0)
    ) {
      if (isVerbose()) logVerbose("Discord: no reply configured.");
      return;
    }

    await sendReply(message, reply, config);
    logger.info(
      {
        userId: normalized.userId,
        channelId: normalized.channelId,
        replyChars: reply.text?.length ?? 0,
        hasMedia: Boolean(reply.mediaUrl || reply.mediaUrls?.length),
      },
      "Discord reply sent",
    );
    console.log(success(`↩️  Discord reply to ${source}`));
  } catch (err) {
    logger.error(
      { error: String(err), channelId: normalized.channelId },
      "Discord reply failed",
    );
    console.error(danger(`Discord reply failed: ${String(err)}`));
  }
}

export function registerDiscordHandlers(
  client: Client,
  botUserId: string,
  config: DiscordRuntimeConfig,
): void {
  client.on("messageCreate", async (message) => {
    await handleDiscordMessage(message, botUserId, config);
  });
  const logger = getChildLogger({ module: "discord-events" });
  logger.info(
    {
      mentionOnly: config.mentionOnly,
      replyInThread: config.replyInThread,
      allowUsers: config.allowedUsers.length,
      allowChannels: config.allowedChannels.length,
      allowGuilds: config.allowedGuilds.length,
    },
    "Discord message handler registered",
  );
  if (isVerbose()) {
    console.log(
      info(
        `Discord handler ready (mentionOnly=${config.mentionOnly}, replyInThread=${config.replyInThread})`,
      ),
    );
  }
}
