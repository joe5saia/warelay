import { describe, expect, it, vi } from "vitest";

import { HEARTBEAT_TOKEN } from "../web/auto-reply.js";
import {
  DEFAULT_DISCORD_HEARTBEAT_SECONDS,
  resolveDiscordHeartbeatSeconds,
  runDiscordHeartbeatOnce,
} from "./heartbeat.js";
import type { DiscordRuntimeConfig } from "./types.js";

const baseConfig: DiscordRuntimeConfig = {
  botToken: "token",
  allowedUsers: [],
  allowedChannels: [],
  allowedGuilds: [],
  mentionOnly: true,
  replyInThread: true,
};

function createClient(sendMock = vi.fn()) {
  const dmChannel = {
    send: sendMock,
    sendTyping: vi.fn().mockResolvedValue(undefined),
  };
  const user = {
    id: "user-123",
    createDM: vi.fn().mockResolvedValue(dmChannel),
  };
  const client = {
    users: {
      fetch: vi.fn().mockResolvedValue(user),
    },
  };
  return { client, user, dmChannel, sendMock };
}

describe("resolveDiscordHeartbeatSeconds", () => {
  it("prefers override", () => {
    const cfg = { ...baseConfig, heartbeatSeconds: 10, heartbeatUserId: "u1" };
    expect(resolveDiscordHeartbeatSeconds(cfg, 30)).toBe(30);
  });

  it("defaults to config value", () => {
    const cfg = { ...baseConfig, heartbeatSeconds: 15, heartbeatUserId: "u1" };
    expect(resolveDiscordHeartbeatSeconds(cfg)).toBe(15);
  });

  it("falls back to default when userId present", () => {
    const cfg = { ...baseConfig, heartbeatUserId: "u1" };
    expect(resolveDiscordHeartbeatSeconds(cfg)).toBe(
      DEFAULT_DISCORD_HEARTBEAT_SECONDS,
    );
  });

  it("returns null when no target configured", () => {
    expect(resolveDiscordHeartbeatSeconds(baseConfig)).toBeNull();
  });
});

describe("runDiscordHeartbeatOnce", () => {
  it("sends DM when reply has content", async () => {
    const { client, sendMock } = createClient(
      vi.fn().mockResolvedValue({
        id: "msg-1",
        channelId: "dm",
        createdAt: new Date(),
      }),
    );

    await runDiscordHeartbeatOnce({
      client,
      botUserId: "bot-1",
      userId: "user-123",
      config: { ...baseConfig, heartbeatUserId: "user-123" },
      cfg: {},
      replyResolver: vi.fn().mockResolvedValue({ text: "hi there" }),
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0]).toMatchObject({
      content: "hi there",
    });
  });

  it("skips when reply is heartbeat token", async () => {
    const { client, sendMock } = createClient(
      vi.fn().mockResolvedValue({
        id: "msg-1",
        channelId: "dm",
        createdAt: new Date(),
      }),
    );

    await runDiscordHeartbeatOnce({
      client,
      botUserId: "bot-1",
      userId: "user-123",
      config: { ...baseConfig, heartbeatUserId: "user-123" },
      cfg: {},
      replyResolver: vi.fn().mockResolvedValue({ text: HEARTBEAT_TOKEN }),
    });

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("uses overrideBody when provided", async () => {
    const sendMock = vi.fn().mockResolvedValue({
      id: "msg-2",
      channelId: "dm",
      createdAt: new Date(),
    });
    const { client } = createClient(sendMock);
    const replyResolver = vi.fn();

    await runDiscordHeartbeatOnce({
      client,
      botUserId: "bot-1",
      userId: "user-123",
      config: { ...baseConfig, heartbeatUserId: "user-123" },
      cfg: {},
      replyResolver,
      overrideBody: "manual",
    });

    expect(replyResolver).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0]).toMatchObject({ content: "manual" });
  });
});
