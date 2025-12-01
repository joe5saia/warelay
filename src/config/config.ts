import fs from "node:fs";
import path from "node:path";

import JSON5 from "json5";
import { z } from "zod";
import {
  type ConfigRuntimeContext,
  resolveConfigPath,
  resolveProfilePaths,
} from "./runtime.js";

export type ReplyMode = "text" | "command";
export type ClaudeOutputFormat = "text" | "json" | "stream-json";
export type SessionScope = "per-sender" | "global";

export type SessionConfig = {
  scope?: SessionScope;
  resetTriggers?: string[];
  idleMinutes?: number;
  heartbeatIdleMinutes?: number;
  store?: string;
  sessionArgNew?: string[];
  sessionArgResume?: string[];
  sessionArgBeforeBody?: boolean;
  sendSystemOnce?: boolean;
  sessionIntro?: string;
  sessionIntroPath?: string;
  typingIntervalSeconds?: number;
  heartbeatMinutes?: number;
};

export type LoggingConfig = {
  level?: "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  file?: string;
};

export type WebReconnectConfig = {
  initialMs?: number;
  maxMs?: number;
  factor?: number;
  jitter?: number;
  maxAttempts?: number; // 0 = unlimited
};

export type WebConfig = {
  heartbeatSeconds?: number;
  reconnect?: WebReconnectConfig;
};

export type DiscordConfig = {
  botToken?: string;
  allowedUsers?: string[];
  allowedChannels?: string[];
  allowedGuilds?: string[];
  mentionOnly?: boolean;
  replyInThread?: boolean;
  assistantLabel?: string;
  persona?: string;
  showAssistantLabel?: boolean;
  heartbeatSeconds?: number;
  heartbeatUserId?: string;
};

export type WarelayConfig = {
  logging?: LoggingConfig;
  inbound?: {
    allowFrom?: string[]; // E.164 numbers allowed to trigger auto-reply (without whatsapp:)
    samePhoneMarker?: string; // Prefix for same-phone mode messages (default: "[same-phone]")
    transcribeAudio?: {
      // Optional CLI to turn inbound audio into text; templated args, must output transcript to stdout.
      command: string[];
      timeoutSeconds?: number;
    };
    reply?: {
      mode: ReplyMode;
      text?: string; // for mode=text, can contain {{Body}}
      command?: string[]; // for mode=command, argv with templates
      cwd?: string; // working directory for command execution
      template?: string; // prepend template string when building command/prompt
      timeoutSeconds?: number; // optional command timeout; defaults to 600s
      bodyPrefix?: string; // optional string prepended to Body before templating
      mediaUrl?: string; // optional media attachment (path or URL)
      session?: SessionConfig;
      claudeOutputFormat?: ClaudeOutputFormat; // when command starts with `claude`, force an output format
      mediaMaxMb?: number; // optional cap for outbound media (default 5MB)
      typingIntervalSeconds?: number; // how often to refresh typing indicator while command runs
      heartbeatMinutes?: number; // auto-ping cadence for command mode
    };
  };
  web?: WebConfig;
  discord?: DiscordConfig;
};

const ReplySchema = z
  .object({
    mode: z.union([z.literal("text"), z.literal("command")]),
    text: z.string().optional(),
    command: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    template: z.string().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    bodyPrefix: z.string().optional(),
    mediaUrl: z.string().optional(),
    mediaMaxMb: z.number().positive().optional(),
    typingIntervalSeconds: z.number().int().positive().optional(),
    session: z
      .object({
        scope: z
          .union([z.literal("per-sender"), z.literal("global")])
          .optional(),
        resetTriggers: z.array(z.string()).optional(),
        idleMinutes: z.number().int().positive().optional(),
        heartbeatIdleMinutes: z.number().int().positive().optional(),
        store: z.string().optional(),
        sessionArgNew: z.array(z.string()).optional(),
        sessionArgResume: z.array(z.string()).optional(),
        sessionArgBeforeBody: z.boolean().optional(),
        sendSystemOnce: z.boolean().optional(),
        sessionIntro: z.string().optional(),
        sessionIntroPath: z.string().optional(),
        typingIntervalSeconds: z.number().int().positive().optional(),
      })
      .optional(),
    heartbeatMinutes: z.number().int().nonnegative().optional(),
    claudeOutputFormat: z
      .union([
        z.literal("text"),
        z.literal("json"),
        z.literal("stream-json"),
        z.undefined(),
      ])
      .optional(),
  })
  .refine(
    (val) => (val.mode === "text" ? Boolean(val.text) : Boolean(val.command)),
    {
      message:
        "reply.text is required for mode=text; reply.command is required for mode=command",
    },
  );

const WarelaySchema = z.object({
  logging: z
    .object({
      level: z
        .union([
          z.literal("silent"),
          z.literal("fatal"),
          z.literal("error"),
          z.literal("warn"),
          z.literal("info"),
          z.literal("debug"),
          z.literal("trace"),
        ])
        .optional(),
      file: z.string().optional(),
    })
    .optional(),
  inbound: z
    .object({
      allowFrom: z.array(z.string()).optional(),
      samePhoneMarker: z.string().optional(),
      transcribeAudio: z
        .object({
          command: z.array(z.string()),
          timeoutSeconds: z.number().int().positive().optional(),
        })
        .optional(),
      reply: ReplySchema.optional(),
    })
    .optional(),
  web: z
    .object({
      heartbeatSeconds: z.number().int().positive().optional(),
      reconnect: z
        .object({
          initialMs: z.number().positive().optional(),
          maxMs: z.number().positive().optional(),
          factor: z.number().positive().optional(),
          jitter: z.number().min(0).max(1).optional(),
          maxAttempts: z.number().int().min(0).optional(),
        })
        .optional(),
    })
    .optional(),
  discord: z
    .object({
      botToken: z.string().min(1).optional(),
      allowedUsers: z.array(z.string()).optional(),
      allowedChannels: z.array(z.string()).optional(),
      allowedGuilds: z.array(z.string()).optional(),
      mentionOnly: z.boolean().optional(),
      replyInThread: z.boolean().optional(),
      assistantLabel: z.string().optional(),
      persona: z.string().optional(),
      showAssistantLabel: z.boolean().optional(),
      heartbeatSeconds: z.number().int().positive().optional(),
      heartbeatUserId: z.string().min(1).optional(),
    })
    .optional(),
});

export type ConfigLoadOptions = ConfigRuntimeContext & {
  require?: boolean;
};

export type ConfigLoadResult = {
  config: WarelayConfig;
  profile?: string;
  configPath: string | null;
  source: ReturnType<typeof resolveConfigPath>["source"];
  warnings: string[];
};

export function loadConfigWithMeta(opts?: ConfigLoadOptions): ConfigLoadResult {
  const warnings: string[] = [];
  const resolvedPaths = resolveProfilePaths(opts);
  const requireConfig = opts?.require ?? resolvedPaths.source !== "legacy";

  if (!resolvedPaths.exists) {
    if (requireConfig) {
      throw new Error(
        `Config not found for profile "${resolvedPaths.profileLabel}" at ${resolvedPaths.path}`,
      );
    }
    warnings.push(
      `Config not found at ${resolvedPaths.path}; proceeding with defaults`,
    );
    return {
      config: {},
      profile: resolvedPaths.profile ?? undefined,
      configPath: null,
      source: resolvedPaths.source,
      warnings,
    };
  }

  try {
    const raw = fs.readFileSync(resolvedPaths.path, "utf-8");
    const parsed = JSON5.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Config root must be an object");
    }
    const validated = WarelaySchema.safeParse(parsed);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((iss) => `${iss.path.join(".") || "<root>"}: ${iss.message}`)
        .join("; ");
      throw new Error(`Invalid warelay config: ${issues}`);
    }
    return {
      config: validated.data as WarelayConfig,
      profile: resolvedPaths.profile ?? undefined,
      configPath: resolvedPaths.path,
      source: resolvedPaths.source,
      warnings,
    };
  } catch (err) {
    if (requireConfig) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    console.error(`Failed to read config at ${resolvedPaths.path}`, err);
    return {
      config: {},
      profile: resolvedPaths.profile ?? undefined,
      configPath: null,
      source: resolvedPaths.source,
      warnings,
    };
  }
}

export function loadConfig(opts?: ConfigLoadOptions): WarelayConfig {
  const { config } = loadConfigWithMeta(opts);
  return config;
}

export function resolveSessionIntro(
  sessionCfg?: SessionConfig,
  configDirOverride?: string,
): string | undefined {
  if (!sessionCfg) return undefined;
  const { sessionIntroPath, sessionIntro } = sessionCfg;
  if (sessionIntroPath) {
    const resolvedConfig = resolveConfigPath();
    const configDir = configDirOverride ?? resolvedConfig.configDir;
    const resolvedPath = path.isAbsolute(sessionIntroPath)
      ? sessionIntroPath
      : path.join(configDir, sessionIntroPath);
    try {
      if (!fs.existsSync(resolvedPath)) {
        console.error(
          `sessionIntroPath not found: ${resolvedPath}. Falling back to inline sessionIntro if provided.`,
        );
      } else {
        return fs.readFileSync(resolvedPath, "utf-8");
      }
    } catch (err) {
      console.error(
        `Failed to read sessionIntroPath at ${resolvedPath}. Falling back to inline sessionIntro if provided.`,
        err,
      );
    }
  }

  return sessionIntro;
}
