import {
  Client,
  type ClientOptions,
  GatewayIntentBits,
  Partials,
} from "discord.js";

import { loadConfig, type WarelayConfig } from "../config/config.js";
import { logVerbose } from "../globals.js";
import { getChildLogger } from "../logging.js";
import type { DiscordRuntimeConfig } from "./types.js";

export const DEFAULT_CLIENT_OPTIONS: ClientOptions = {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
};

export function createDiscordClient(
  options: Partial<ClientOptions> = {},
): Client {
  return new Client({
    ...DEFAULT_CLIENT_OPTIONS,
    ...options,
  });
}

export function resolveDiscordConfig(
  cfg?: WarelayConfig,
): DiscordRuntimeConfig {
  const config = cfg ?? loadConfig();
  const discordCfg = config.discord ?? {};
  const botToken = process.env.DISCORD_BOT_TOKEN ?? discordCfg.botToken;
  if (!botToken) {
    throw new Error(
      "DISCORD_BOT_TOKEN missing. Set it in your environment or warelay config before using provider=discord.",
    );
  }
  return {
    botToken,
    allowedUsers: discordCfg.allowedUsers ?? [],
    allowedChannels: discordCfg.allowedChannels ?? [],
    allowedGuilds: discordCfg.allowedGuilds ?? [],
    mentionOnly: discordCfg.mentionOnly ?? true,
    replyInThread: discordCfg.replyInThread ?? true,
  };
}

async function waitForReady(client: Client): Promise<void> {
  if (client.isReady()) return;
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      client.off("clientReady", onReady);
      client.off("error", onError);
    };
    client.once("clientReady", onReady);
    client.once("error", onError);
  });
}

export async function createAndLoginDiscordClient(
  config?: DiscordRuntimeConfig,
  options?: Partial<ClientOptions>,
): Promise<{
  client: Client;
  botUserId: string;
  botTag: string;
  config: DiscordRuntimeConfig;
}> {
  const resolvedConfig = config ?? resolveDiscordConfig();
  const client = createDiscordClient(options);
  const logger = getChildLogger({ module: "discord-client" });
  await client.login(resolvedConfig.botToken);
  await waitForReady(client);
  const botUserId = client.user?.id;
  const botTag = client.user?.tag;
  if (!botUserId || !botTag) {
    throw new Error("Discord client logged in but user identity is missing");
  }
  logVerbose(`Discord: logged in as ${botTag}`);
  logger.info({ botUserId, botTag }, "Discord client ready");
  return { client, botUserId, botTag, config: resolvedConfig };
}
