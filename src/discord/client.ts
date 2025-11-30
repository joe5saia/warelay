import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  Client,
  type ClientOptions,
  GatewayIntentBits,
  Partials,
} from "discord.js";

import { loadConfig, type WarelayConfig } from "../config/config.js";
import { resolveProfilePaths, WARELAY_HOME_DIR } from "../config/runtime.js";
import { logVerbose } from "../globals.js";
import { getChildLogger } from "../logging.js";
import type { DiscordRuntimeConfig } from "./types.js";

const DISCORD_TOKEN_FILENAME = "discord-token";

export const DEFAULT_CLIENT_OPTIONS: ClientOptions = {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
};

function getDiscordTokenPath() {
  const { credentialsDir } = resolveProfilePaths();
  return path.join(credentialsDir, DISCORD_TOKEN_FILENAME);
}

function readDiscordTokenFromProfile(): string | undefined {
  const tokenPath = getDiscordTokenPath();
  try {
    const raw = fs.readFileSync(tokenPath, "utf-8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

function persistDiscordTokenToProfile(botToken: string) {
  const tokenPath = getDiscordTokenPath();
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  const existing = readDiscordTokenFromProfile();
  if (existing === botToken) return;
  fs.writeFileSync(tokenPath, botToken, { encoding: "utf-8", mode: 0o600 });
}

function ensureDiscordTokenNotReused(botToken: string) {
  const hash = crypto.createHash("sha256").update(botToken).digest("hex");
  const registryPath = path.join(
    WARELAY_HOME_DIR,
    "state",
    "discord-tokens.json",
  );
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  let registry: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(registryPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      registry = parsed as Record<string, string>;
    }
  } catch {
    registry = {};
  }
  const { profileLabel } = resolveProfilePaths();
  for (const [profile, storedHash] of Object.entries(registry)) {
    if (profile !== profileLabel && storedHash === hash) {
      throw new Error(
        `Discord bot token already recorded for profile "${profile}". Use unique tokens per profile.`,
      );
    }
  }
  registry[profileLabel] = hash;
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

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
  const storedToken = readDiscordTokenFromProfile();
  const botToken =
    process.env.DISCORD_BOT_TOKEN ?? discordCfg.botToken ?? storedToken;
  if (!botToken) {
    throw new Error(
      "DISCORD_BOT_TOKEN missing. Set it in your environment or warelay config before using provider=discord.",
    );
  }
  // Cache token per profile to simplify multi-bot setups.
  persistDiscordTokenToProfile(botToken);
  return {
    botToken,
    allowedUsers: discordCfg.allowedUsers ?? [],
    allowedChannels: discordCfg.allowedChannels ?? [],
    allowedGuilds: discordCfg.allowedGuilds ?? [],
    mentionOnly: discordCfg.mentionOnly ?? true,
    replyInThread: discordCfg.replyInThread ?? true,
    assistantLabel: discordCfg.assistantLabel,
    assistantPersona: discordCfg.persona,
    showAssistantLabel: discordCfg.showAssistantLabel ?? false,
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
  ensureDiscordTokenNotReused(resolvedConfig.botToken);
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
