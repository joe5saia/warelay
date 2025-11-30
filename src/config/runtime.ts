import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROFILE_RE = /^[a-z0-9_-]+$/;

export type ConfigRuntimeContext = {
  profile?: string;
  configPath?: string;
};

export type ConfigSource = "flag" | "env" | "profile" | "legacy";

export type ResolvedConfigPath = {
  path: string;
  source: ConfigSource;
  profile?: string;
  exists: boolean;
  configDir: string;
};

export type ProfilePaths = ResolvedConfigPath & {
  credentialsDir: string;
  stateDir: string;
  mediaDir: string;
  logDir: string;
  logFile: string;
  sessionStorePath: string;
  profileLabel: string;
};

const WARELAY_HOME = path.join(os.homedir(), ".warelay");
const LEGACY_CONFIG_PATH = path.join(WARELAY_HOME, "warelay.json");
export const WARELAY_HOME_DIR = WARELAY_HOME;
const OS_TMPDIR = typeof os.tmpdir === "function" ? os.tmpdir() : "/tmp";

let runtimeContext: ConfigRuntimeContext = {};

function normalizeProfile(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!PROFILE_RE.test(trimmed)) {
    throw new Error(
      "Profile must match [a-z0-9_-]+ (lowercase letters, numbers, hyphens, underscores)",
    );
  }
  return trimmed;
}

export function setRuntimeConfigContext(ctx: ConfigRuntimeContext): void {
  runtimeContext = {
    profile: normalizeProfile(ctx.profile),
    configPath: ctx.configPath ? path.resolve(ctx.configPath) : undefined,
  };
}

export function getRuntimeConfigContext(): ConfigRuntimeContext {
  return { ...runtimeContext };
}

export function resolveConfigPath(
  override?: ConfigRuntimeContext,
): ResolvedConfigPath {
  const ctx = override ?? runtimeContext;
  const profile = normalizeProfile(ctx.profile);
  const envConfig = process.env.WARELAY_CONFIG_PATH;

  if (ctx.configPath) {
    const resolved = path.resolve(ctx.configPath);
    return {
      path: resolved,
      configDir: path.dirname(resolved),
      source: "flag",
      profile,
      exists: fs.existsSync(resolved),
    };
  }

  if (envConfig) {
    const resolved = path.resolve(envConfig);
    return {
      path: resolved,
      configDir: path.dirname(resolved),
      source: "env",
      profile,
      exists: fs.existsSync(resolved),
    };
  }

  if (profile) {
    const profilePath = path.join(WARELAY_HOME, `warelay.${profile}.json`);
    return {
      path: profilePath,
      configDir: path.dirname(profilePath),
      source: "profile",
      profile,
      exists: fs.existsSync(profilePath),
    };
  }

  return {
    path: LEGACY_CONFIG_PATH,
    configDir: path.dirname(LEGACY_CONFIG_PATH),
    source: "legacy",
    profile,
    exists: fs.existsSync(LEGACY_CONFIG_PATH),
  };
}

export function resolveProfilePaths(
  override?: ConfigRuntimeContext,
): ProfilePaths {
  const resolvedConfig = resolveConfigPath(override);
  const profile = resolvedConfig.profile;

  const credentialsDir = profile
    ? path.join(WARELAY_HOME, "credentials", profile)
    : path.join(WARELAY_HOME, "credentials");
  const stateDir = profile
    ? path.join(WARELAY_HOME, "state", profile)
    : WARELAY_HOME;
  const mediaDir = profile
    ? path.join(WARELAY_HOME, "media", profile)
    : path.join(WARELAY_HOME, "media");
  const logDir = profile
    ? path.join(OS_TMPDIR, "warelay", profile)
    : path.join(OS_TMPDIR, "warelay");
  const logFile = path.join(logDir, "warelay.log");
  const sessionStorePath = path.join(stateDir, "sessions.json");
  const profileLabel = profile ?? "default";

  return {
    ...resolvedConfig,
    credentialsDir,
    stateDir,
    mediaDir,
    logDir,
    logFile,
    sessionStorePath,
    profileLabel,
  };
}

export function getProfileTag(
  ctx: ConfigRuntimeContext = runtimeContext,
): string {
  const profile = ctx.profile ?? runtimeContext.profile;
  return profile ? `[profile=${profile}]` : "";
}

export function resolveProfilePort(basePort: number): number {
  const { profile } = resolveConfigPath();
  if (!profile) return basePort;
  const hash = Array.from(profile).reduce(
    (acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1000,
    0,
  );
  const offset = (hash % 1000) + 1; // keep away from the exact base port
  const candidate = basePort + offset;
  if (candidate <= 65535) return candidate;
  const room = Math.max(1, 65535 - basePort);
  return basePort + (offset % room);
}
