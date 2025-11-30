import type {
  Message,
  MessageCreateOptions,
  TextBasedChannel,
} from "discord.js";

import type { ReplyPayload } from "../auto-reply/types.js";
import type { DiscordSendResult } from "./types.js";

export const DISCORD_MAX_MESSAGE_LENGTH = 2000;

export type SendableChannel = TextBasedChannel & {
  send: (options: MessageCreateOptions) => Promise<Message>;
};

function isSendableChannel(
  channel: TextBasedChannel,
): channel is SendableChannel {
  return (
    "send" in channel &&
    typeof (channel as { send?: unknown }).send === "function"
  );
}

export function chunkMessage(text: string): string[] {
  if (!text) return [];
  const max = DISCORD_MAX_MESSAGE_LENGTH;
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > max) {
    let splitAt = remaining.lastIndexOf("\n", max);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(" ", max);
    if (splitAt <= 0) splitAt = max;
    const chunk = remaining.slice(0, splitAt).trimEnd();
    chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

async function sendChunk(
  channel: SendableChannel,
  payload: MessageCreateOptions,
  results: DiscordSendResult[],
) {
  if (!payload.content && (!payload.files || payload.files.length === 0)) {
    return;
  }
  const sent = await channel.send(payload);
  results.push({
    messageId: sent.id,
    channelId: sent.channelId,
    timestamp: sent.createdAt,
  });
}

export async function sendDiscordMessage(
  channel: SendableChannel,
  content: string,
  mediaUrls: string[] = [],
): Promise<DiscordSendResult[]> {
  const results: DiscordSendResult[] = [];
  const chunks = chunkMessage(content);
  const files = mediaUrls.filter(Boolean);

  if (chunks.length === 0 && files.length === 0) return results;

  if (chunks.length === 0) {
    await sendChunk(channel, { files }, results);
    return results;
  }

  for (let idx = 0; idx < chunks.length; idx += 1) {
    const payload: MessageCreateOptions = { content: chunks[idx] };
    if (idx === 0 && files.length > 0) {
      payload.files = files;
    }
    await sendChunk(channel, payload, results);
  }

  return results;
}

function resolveReplyChannel(
  message: Message,
  replyInThread: boolean,
): SendableChannel {
  let channel: TextBasedChannel = message.channel;
  const isThread =
    "isThread" in channel &&
    typeof (channel as { isThread?: () => boolean }).isThread === "function" &&
    (channel as { isThread?: () => boolean }).isThread?.() === true;

  if (!replyInThread && isThread) {
    const parent = (channel as { parent?: unknown }).parent as unknown;
    const maybeText = parent as { isTextBased?: () => boolean };
    if (
      parent &&
      typeof maybeText.isTextBased === "function" &&
      maybeText.isTextBased()
    ) {
      channel = parent as TextBasedChannel;
    }
  }

  if (isSendableChannel(channel)) {
    return channel;
  }
  throw new Error("Discord channel is not send-capable");
}

export async function sendDiscordReply(
  message: Message,
  reply: ReplyPayload,
  opts?: { replyInThread?: boolean },
): Promise<DiscordSendResult[]> {
  const replyInThread = opts?.replyInThread ?? true;
  const channel = resolveReplyChannel(message, replyInThread);
  const mediaUrls = [reply.mediaUrl ?? "", ...(reply.mediaUrls ?? [])].filter(
    Boolean,
  );
  const text = reply.text ?? "";
  return sendDiscordMessage(channel, text, mediaUrls);
}
