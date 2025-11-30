import { describe, expect, it } from "vitest";

import { chunkMessage, DISCORD_MAX_MESSAGE_LENGTH } from "./send.js";

describe("chunkMessage", () => {
  it("returns single chunk for short messages", () => {
    const result = chunkMessage("Hello world");
    expect(result).toEqual(["Hello world"]);
  });

  it("splits on newlines when possible", () => {
    const long = `${"a".repeat(1500)}\n${"b".repeat(800)}`;
    const result = chunkMessage(long);
    expect(result.length).toBe(2);
    expect(result[0]).toContain("a".repeat(1500));
    expect(result[1]).toContain("b".repeat(800));
  });

  it("splits on spaces when no newline is available", () => {
    const long = "word ".repeat(600);
    const result = chunkMessage(long);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MAX_MESSAGE_LENGTH);
    }
  });

  it("handles exact limit without splitting", () => {
    const exact = "a".repeat(DISCORD_MAX_MESSAGE_LENGTH);
    expect(chunkMessage(exact)).toEqual([exact]);
  });

  it("returns empty array for empty text", () => {
    expect(chunkMessage("")).toEqual([]);
  });
});
