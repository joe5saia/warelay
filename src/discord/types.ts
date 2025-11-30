/**
 * Discord provider type definitions.
 */

import type { Message } from "discord.js";

export type DiscordRuntimeConfig = {
  botToken: string;
  allowedUsers: string[];
  allowedChannels: string[];
  allowedGuilds: string[];
  mentionOnly: boolean;
  replyInThread: boolean;
};

export type NormalizedDiscordMessage = {
  userId: string;
  userTag: string;
  channelId: string;
  guildId: string | null;
  messageId: string;
  content: string;
  isDM: boolean;
  isMention: boolean;
  isThread: boolean;
  threadId: string | null;
  timestamp: Date;
  rawMessage: Message;
};

export type DiscordMonitorOptions = {
  verbose: boolean;
  onMessage?: (msg: NormalizedDiscordMessage) => Promise<void>;
  abortSignal?: AbortSignal;
};

export type DiscordSendResult = {
  messageId: string;
  channelId: string;
  timestamp: Date;
};
