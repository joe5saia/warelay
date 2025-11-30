import { describe, expect, it } from "vitest";

import { stripBotMention } from "./events.js";

describe("stripBotMention", () => {
  const botId = "123456789";

  it("removes standard mention", () => {
    const content = "<@123456789> hello world";
    expect(stripBotMention(content, botId)).toBe("hello world");
  });

  it("removes nickname mention", () => {
    const content = "<@!123456789> hello";
    expect(stripBotMention(content, botId)).toBe("hello");
  });

  it("removes multiple mentions", () => {
    const content = "<@123456789> test <@123456789> message";
    expect(stripBotMention(content, botId)).toBe("test message");
  });

  it("keeps other mentions intact", () => {
    const content = "<@123456789> hi <@987654321>";
    expect(stripBotMention(content, botId)).toBe("hi <@987654321>");
  });

  it("trims whitespace", () => {
    const content = "   <@123456789>   hello   ";
    expect(stripBotMention(content, botId)).toBe("hello");
  });
});
