import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfigWithMeta, type WarelayConfig } from "./config.js";

const tmpFiles: string[] = [];

function writeTempConfig(cfg: WarelayConfig) {
  const file = path.join(os.tmpdir(), `warelay-config-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), "utf-8");
  tmpFiles.push(file);
  return file;
}

describe("loadConfigWithMeta", () => {
  beforeEach(() => {
    // isolate env-driven resolution between tests
    delete process.env.WARELAY_CONFIG_PATH;
    delete process.env.WARELAY_PROFILE;
    delete process.env.WARELAY_PROFILE_NAME;
  });

  afterEach(() => {
    for (const file of tmpFiles.splice(0)) {
      try {
        fs.unlinkSync(file);
      } catch {}
    }
  });

  it("loads config from explicit flag path", () => {
    const file = writeTempConfig({ logging: { level: "debug" } });
    const res = loadConfigWithMeta({ configPath: file });
    expect(res.config.logging?.level).toBe("debug");
    expect(res.configPath).toBe(file);
    expect(res.source).toBe("flag");
  });

  it("throws when required flag path is missing", () => {
    const missing = path.join(os.tmpdir(), "warelay-missing-config.json");
    expect(() =>
      loadConfigWithMeta({ configPath: missing, require: true }),
    ).toThrow(/Config not found/);
  });

  it("honors profile label when flag path is provided", () => {
    const file = writeTempConfig({ discord: { mentionOnly: true } });
    const res = loadConfigWithMeta({ configPath: file, profile: "partner" });
    expect(res.profile).toBe("partner");
    expect(res.source).toBe("flag");
    expect(res.config.discord?.mentionOnly).toBe(true);
  });
});
