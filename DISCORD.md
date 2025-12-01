# Discord Integration Plan for Warelay

## Table of Contents
1. [Overview](#overview)
2. [Background: How Warelay Works](#background-how-warelay-works)
3. [Discord Concepts You Need to Know](#discord-concepts-you-need-to-know)
4. [Prerequisites: Discord Developer Portal Setup](#prerequisites-discord-developer-portal-setup)
5. [Implementation Plan](#implementation-plan)
6. [Detailed File-by-File Implementation](#detailed-file-by-file-implementation)
7. [Testing Your Implementation](#testing-your-implementation)
8. [Common Gotchas and Troubleshooting](#common-gotchas-and-troubleshooting)
9. [Future Enhancements](#future-enhancements)

---

## Overview

### What is Warelay?

Warelay is a CLI tool that acts as a "relay" between messaging platforms and AI assistants (like Claude). Currently it supports:
- **Twilio**: WhatsApp Business API
- **Web**: Personal WhatsApp via QR code login

### What Are We Building?

We're adding **Discord** as a third provider. When complete, users will be able to:
- Run `warelay relay --provider discord` to listen for Discord messages
- The bot will respond to DMs and @mentions using Claude (or other configured commands)
- Run `warelay send --provider discord --to <channel-id> --message "Hello"` to send messages
- Optionally run heartbeat DMs: set `discord.heartbeatUserId` per profile and start the relay with `--discord-heartbeat <seconds>` (e.g., 60) to send the `HEARTBEAT ultrathink` probe and forward non-empty replies as DMs.

### Finding your Discord user ID
1) In Discord, open **User Settings → Advanced** and toggle on **Developer Mode**.  
2) Right-click (or long-press on mobile) your own profile or any message you sent.  
3) Click **Copy User ID**. This is the value to use for `discord.heartbeatUserId`.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLI Commands                               │
│                                                                      │
│   warelay send          warelay relay          warelay status        │
│        │                     │                      │                │
└────────┼─────────────────────┼──────────────────────┼────────────────┘
         │                     │                      │
         ▼                     ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           Providers                                  │
│                                                                      │
│   ┌─────────┐         ┌─────────┐         ┌─────────────┐           │
│   │ Twilio  │         │   Web   │         │  Discord    │           │
│   │(existing)│        │(existing)│        │   (NEW)     │           │
│   └─────────┘         └─────────┘         └─────────────┘           │
│                                                  │                   │
└──────────────────────────────────────────────────┼───────────────────┘
                                                   │
                                                   ▼
                              ┌─────────────────────────────────────┐
                              │         src/discord/                 │
                              │                                      │
                              │  client.ts  - Discord.js client      │
                              │  events.ts  - Message handlers       │
                              │  send.ts    - Send/reply logic       │
                              │  types.ts   - Type definitions       │
                              └──────────────────┬──────────────────┘
                                                 │
                                                 ▼
                              ┌─────────────────────────────────────┐
                              │     Core Logic (UNCHANGED)          │
                              │                                      │
                              │  getReplyFromConfig() - Auto-reply   │
                              │  Session management                  │
                              │  Claude CLI integration              │
                              └─────────────────────────────────────┘
```

### Key Principle: Don't Reinvent the Wheel

The existing `getReplyFromConfig()` function in `src/auto-reply/reply.ts` handles ALL the complex logic:
- Loading configuration
- Managing sessions (per-user conversation memory)
- Running Claude CLI commands
- Templating responses

**Your job is to:**
1. Listen for Discord messages
2. Convert them to a `MsgContext` object (the format `getReplyFromConfig` expects)
3. Call `getReplyFromConfig()` with that context
4. Send the response back to Discord

You do NOT need to understand or modify the Claude integration, session management, or templating logic.

---

## Background: How Warelay Works

### The Message Flow

```
1. User sends message on Discord
         │
         ▼
2. Discord Gateway sends event to our bot
         │
         ▼
3. Our handler creates a MsgContext object:
   {
     Body: "What's the weather?",      // The message text
     From: "123456789",                 // Discord user ID
     To: "987654321",                   // Discord channel ID
     MessageSid: "111222333"            // Discord message ID
   }
         │
         ▼
4. Call getReplyFromConfig(ctx, options, config)
         │
         ▼
5. getReplyFromConfig() internally:
   - Checks if sender is allowed (config.inbound.allowFrom)
   - Manages session state
   - Runs Claude CLI or returns static text
   - Returns { text: "It's sunny!", mediaUrl?: "..." }
         │
         ▼
6. We send the reply back to Discord
```

### Key Files to Understand

Before you start coding, read these files to understand the patterns:

| File | Purpose | Why You Should Read It |
|------|---------|------------------------|
| `src/web/auto-reply.ts` | Web provider's message handling loop | Shows the pattern you'll follow |
| `src/auto-reply/reply.ts` | Core `getReplyFromConfig()` function | The function you'll call |
| `src/auto-reply/types.ts` | `MsgContext` and `ReplyPayload` types | The data structures you'll use |
| `src/config/config.ts` | Configuration schema | Where you'll add Discord config |
| `src/cli/program.ts` | CLI command definitions | Where you'll wire up Discord |
| `src/providers/provider.types.ts` | Provider type definition | You'll add "discord" here |

### The MsgContext Interface

This is the input format that `getReplyFromConfig()` expects:

```typescript
type MsgContext = {
  Body?: string;       // The message text
  From?: string;       // Sender identifier (user ID, phone number, etc.)
  To?: string;         // Recipient/channel identifier
  MessageSid?: string; // Unique message ID (used for sessions)
  MediaUrl?: string;   // Optional: URL of attached media
  MediaType?: string;  // Optional: MIME type of media
  MediaPath?: string;  // Optional: Local path to downloaded media
  Transcript?: string; // Optional: Audio transcription
};
```

### The ReplyPayload Interface

This is what `getReplyFromConfig()` returns:

```typescript
type ReplyPayload = {
  text?: string;       // The reply text
  mediaUrl?: string;   // Optional: Single media attachment
  mediaUrls?: string[]; // Optional: Multiple media attachments
};
```

---

## Discord Concepts You Need to Know

### Terminology

| Discord Term | What It Means | Warelay Equivalent |
|--------------|---------------|-------------------|
| Guild | A Discord server | N/A (we work across guilds) |
| Channel | A text channel in a guild | Similar to "To" in Twilio |
| DM | Direct message to the bot | Similar to WhatsApp DM |
| Thread | A sub-conversation in a channel | We reply in threads if started in one |
| Mention | When someone types `@BotName` | How users invoke the bot in channels |
| Snowflake | Discord's unique ID format | Used for user/channel/message IDs |
| Intent | Permission to receive certain events | Critical for receiving message content |

### How Discord Bots Work

```
┌─────────────────────┐     WebSocket      ┌─────────────────────┐
│   Discord Servers   │ ◄─────────────────► │    Your Bot Code    │
│   (Their servers)   │     (Gateway)       │   (Your computer)   │
└─────────────────────┘                     └─────────────────────┘
```

1. Your bot connects to Discord's Gateway (WebSocket server)
2. Discord sends events when things happen (messages, reactions, etc.)
3. Your bot receives these events and can respond via Discord's API

### Discord.js Library

We'll use `discord.js` v14, the standard Node.js library for Discord bots.

```typescript
import { Client, GatewayIntentBits } from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // Know about servers
    GatewayIntentBits.GuildMessages,    // See messages in servers
    GatewayIntentBits.DirectMessages,   // See DMs
    GatewayIntentBits.MessageContent,   // See message text (CRITICAL!)
  ],
});

client.on("messageCreate", (message) => {
  console.log(`${message.author.tag}: ${message.content}`);
});

client.login("your-bot-token");
```

### Intents: The Most Common Mistake

**CRITICAL**: Discord requires you to explicitly request permission to see message content.

Without `MessageContent` intent enabled:
- `message.content` will be an empty string `""`
- Your bot will appear to receive messages but can't read them

You must enable this in TWO places:
1. In your code: `GatewayIntentBits.MessageContent`
2. In Discord Developer Portal: Privileged Gateway Intents → MESSAGE CONTENT INTENT

### Message Types We Care About

1. **DMs to the bot**: User sends a direct message
   - `message.channel.type === ChannelType.DM`
   - Always respond (no mention needed)

2. **Mentions in channels**: User types `@BotName some question`
   - `message.mentions.has(client.user.id)`
   - Only respond when mentioned (to avoid spam)

3. **Messages in threads**: User replies in a thread
   - Handle same as channel messages
   - Reply in the same thread

---

## Prerequisites: Discord Developer Portal Setup

### Step 1: Create a Discord Application

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Name it something like "Warelay Bot" or "Claude Assistant"
4. Click "Create"

### Step 2: Create a Bot User

1. In the left sidebar, click "Bot"
2. Click "Add Bot" → "Yes, do it!"
3. Under the bot's username, click "Reset Token"
4. **Copy and save this token** - you won't see it again!
   - Store it in `.env` as `DISCORD_BOT_TOKEN=your-token-here`
   - NEVER commit this token to git

### Step 3: Enable Privileged Intents

This is the step most people forget!

1. Still on the "Bot" page, scroll down to "Privileged Gateway Intents"
2. Enable these toggles:
   - ✅ **MESSAGE CONTENT INTENT** (REQUIRED - without this, `message.content` is empty!)
   - ✅ SERVER MEMBERS INTENT (optional, for future features)
3. Click "Save Changes"

### Step 4: Generate an Invite URL

1. In the left sidebar, click "OAuth2" → "URL Generator"
2. Under "Scopes", check:
   - ✅ `bot`
3. Under "Bot Permissions", check:
   - ✅ Send Messages
   - ✅ Send Messages in Threads
   - ✅ Read Message History
   - ✅ View Channels
4. Copy the generated URL at the bottom
5. Open this URL in your browser to add the bot to your test server

### Step 5: Test the Bot Token

Create a quick test file to verify your setup:

```typescript
// test-discord.ts
import { Client, GatewayIntentBits } from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
```

Run with: `DISCORD_BOT_TOKEN=your-token tsx test-discord.ts`

If you see "✅ Logged in as YourBot#1234", you're ready to proceed!

---

## Implementation Plan

### Overview of Changes

| Task | Files to Create/Modify | Estimated Time |
|------|------------------------|----------------|
| 1. Add discord.js dependency | `package.json` | 2 min |
| 2. Update Provider type | `src/providers/provider.types.ts` | 2 min |
| 3. Add Discord config schema | `src/config/config.ts` | 15 min |
| 4. Create Discord types | `src/discord/types.ts` | 10 min |
| 5. Create Discord client | `src/discord/client.ts` | 15 min |
| 6. Create send helper | `src/discord/send.ts` | 20 min |
| 7. Create event handlers | `src/discord/events.ts` | 30 min |
| 8. Create provider entry point | `src/discord/index.ts` | 15 min |
| 9. Update CLI program | `src/cli/program.ts` | 20 min |
| 10. Update environment helpers | `src/env.ts` | 10 min |
| 11. Write tests | `src/discord/*.test.ts` | 45 min |
| 12. Update documentation | `README.md`, `.env.example` | 15 min |

**Total estimated time: 3-4 hours**

### File Structure

After implementation, your `src/discord/` directory should look like:

```
src/discord/
├── client.ts       # Discord.js client initialization
├── events.ts       # Message event handlers
├── index.ts        # Public exports (provider entry point)
├── send.ts         # Message sending helpers
├── types.ts        # TypeScript type definitions
├── client.test.ts  # Tests for client
├── events.test.ts  # Tests for event handlers
└── send.test.ts    # Tests for send helpers
```

---

## Detailed File-by-File Implementation

### Task 1: Add discord.js Dependency

**File:** `package.json`

Run this command:
```bash
pnpm add discord.js
```

This will add discord.js v14 to your dependencies.

---

### Task 2: Update Provider Type

**File:** `src/providers/provider.types.ts`

**Before:**
```typescript
export type Provider = "twilio" | "web";
```

**After:**
```typescript
export type Provider = "twilio" | "web" | "discord";
```

That's it! This lets the rest of the codebase know "discord" is a valid provider.

---

### Task 3: Add Discord Config Schema

**File:** `src/config/config.ts`

Add the Discord configuration types and schema validation.

**Step 3.1:** Add the TypeScript types (after the existing type definitions, around line 40):

```typescript
// Add after WebConfig type definition

export type DiscordConfig = {
  botToken?: string;         // Discord bot token (xoxb-...)
  allowedUsers?: string[];   // Discord user IDs allowed to trigger auto-reply
  allowedChannels?: string[]; // Discord channel IDs allowed
  allowedGuilds?: string[];  // Discord guild (server) IDs allowed
  mentionOnly?: boolean;     // Only reply when bot is mentioned in channels (default: true)
  replyInThread?: boolean;   // Reply in threads when message is in a thread (default: true)
};
```

**Step 3.2:** Update the WarelayConfig type (around line 70):

```typescript
export type WarelayConfig = {
  logging?: LoggingConfig;
  inbound?: {
    allowFrom?: string[];
    transcribeAudio?: {
      command: string[];
      timeoutSeconds?: number;
    };
    reply?: {
      // ... existing fields ...
    };
  };
  web?: WebConfig;
  discord?: DiscordConfig;  // ADD THIS LINE
};
```

**Step 3.3:** Add Zod schema validation (after the existing schemas, around line 165):

```typescript
// Add after the existing WarelaySchema definition, inside the z.object({})

const WarelaySchema = z.object({
  logging: z.object({ /* ... existing ... */ }).optional(),
  inbound: z.object({ /* ... existing ... */ }).optional(),
  web: z.object({ /* ... existing ... */ }).optional(),
  
  // ADD THIS BLOCK:
  discord: z
    .object({
      botToken: z.string().optional(),
      allowedUsers: z.array(z.string()).optional(),
      allowedChannels: z.array(z.string()).optional(),
      allowedGuilds: z.array(z.string()).optional(),
      mentionOnly: z.boolean().optional(),
      replyInThread: z.boolean().optional(),
    })
    .optional(),
});
```

---

### Task 4: Create Discord Types

**File:** `src/discord/types.ts` (CREATE NEW FILE)

```typescript
/**
 * Discord-specific type definitions for the warelay Discord provider.
 */

import type { Message, Client } from "discord.js";

/**
 * Runtime configuration for the Discord provider.
 * Resolved from WarelayConfig.discord + environment variables.
 */
export type DiscordRuntimeConfig = {
  botToken: string;
  allowedUsers: string[];
  allowedChannels: string[];
  allowedGuilds: string[];
  mentionOnly: boolean;
  replyInThread: boolean;
};

/**
 * Normalized representation of an inbound Discord message.
 * This is an intermediate format before conversion to MsgContext.
 */
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

/**
 * Options for the Discord monitor (relay) function.
 */
export type DiscordMonitorOptions = {
  verbose: boolean;
  onMessage?: (msg: NormalizedDiscordMessage) => Promise<void>;
  abortSignal?: AbortSignal;
};

/**
 * Result of sending a Discord message.
 */
export type DiscordSendResult = {
  messageId: string;
  channelId: string;
  timestamp: Date;
};

/**
 * Options for sending a Discord message.
 */
export type DiscordSendOptions = {
  channelId: string;
  content: string;
  replyToMessageId?: string;
  threadId?: string;
};
```

---

### Task 5: Create Discord Client

**File:** `src/discord/client.ts` (CREATE NEW FILE)

```typescript
/**
 * Discord.js client initialization and configuration.
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  type ClientOptions,
} from "discord.js";
import type { DiscordRuntimeConfig } from "./types.js";
import { loadConfig } from "../config/config.js";

/**
 * Default client options for the Discord bot.
 * These intents are required for basic message handling.
 */
export const DEFAULT_CLIENT_OPTIONS: ClientOptions = {
  intents: [
    GatewayIntentBits.Guilds,           // Required for guild information
    GatewayIntentBits.GuildMessages,    // Required for messages in servers
    GatewayIntentBits.DirectMessages,   // Required for DMs
    GatewayIntentBits.MessageContent,   // Required to read message content (CRITICAL!)
  ],
  partials: [
    Partials.Channel,  // Required for DM channels (they're "partial" by default)
  ],
};

/**
 * Creates a new Discord.js Client with the appropriate intents.
 * Does NOT log in - call client.login(token) separately.
 */
export function createDiscordClient(
  options: Partial<ClientOptions> = {},
): Client {
  return new Client({
    ...DEFAULT_CLIENT_OPTIONS,
    ...options,
  });
}

/**
 * Resolves Discord runtime configuration from config file and environment variables.
 * Environment variables take precedence over config file values.
 * 
 * @throws Error if bot token is not configured
 */
export function resolveDiscordConfig(): DiscordRuntimeConfig {
  const cfg = loadConfig();
  const discordCfg = cfg.discord ?? {};

  const botToken = process.env.DISCORD_BOT_TOKEN ?? discordCfg.botToken;

  if (!botToken) {
    throw new Error(
      "Discord bot token not configured. Set DISCORD_BOT_TOKEN environment variable " +
      "or discord.botToken in ~/.warelay/warelay.json"
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

/**
 * Creates a Discord client and logs in with the configured token.
 * Returns the logged-in client and bot user ID.
 * 
 * @throws Error if login fails or bot user ID cannot be resolved
 */
export async function createAndLoginDiscordClient(): Promise<{
  client: Client;
  botUserId: string;
  botTag: string;
}> {
  const config = resolveDiscordConfig();
  const client = createDiscordClient();

  await client.login(config.botToken);

  const botUserId = client.user?.id;
  const botTag = client.user?.tag;

  if (!botUserId || !botTag) {
    throw new Error("Failed to resolve bot user ID after login");
  }

  return { client, botUserId, botTag };
}
```

---

### Task 6: Create Send Helper

**File:** `src/discord/send.ts` (CREATE NEW FILE)

```typescript
/**
 * Discord message sending utilities.
 * Handles message chunking (Discord's 2000 char limit) and media attachments.
 */

import type { Message, TextChannel, DMChannel, ThreadChannel } from "discord.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { DiscordSendResult } from "./types.js";
import { logVerbose, isVerbose } from "../globals.js";

/**
 * Discord's maximum message length.
 * Messages longer than this must be split into multiple messages.
 */
export const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/**
 * Splits a long message into chunks that fit within Discord's limit.
 * Tries to split on newlines or spaces for cleaner breaks.
 */
export function chunkMessage(text: string, maxLength = DISCORD_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good break point (newline or space)
    let breakPoint = maxLength;
    
    // Look for newline first
    const newlineIndex = remaining.lastIndexOf("\n", maxLength);
    if (newlineIndex > maxLength * 0.5) {
      breakPoint = newlineIndex + 1; // Include the newline in current chunk
    } else {
      // Look for space
      const spaceIndex = remaining.lastIndexOf(" ", maxLength);
      if (spaceIndex > maxLength * 0.5) {
        breakPoint = spaceIndex + 1; // Include the space in current chunk
      }
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint);
  }

  return chunks;
}

/**
 * Sends a reply to a Discord message.
 * Handles:
 * - Long messages (splits into chunks)
 * - Media attachments (as file URLs)
 * - Thread replies
 * 
 * @param originalMessage - The message we're replying to
 * @param reply - The reply payload from getReplyFromConfig
 * @returns Information about the sent message(s)
 */
export async function sendDiscordReply(
  originalMessage: Message,
  reply: ReplyPayload,
): Promise<DiscordSendResult[]> {
  const results: DiscordSendResult[] = [];
  const text = reply.text ?? "";
  
  // Collect all media URLs
  const mediaUrls: string[] = [];
  if (reply.mediaUrls && reply.mediaUrls.length > 0) {
    mediaUrls.push(...reply.mediaUrls);
  } else if (reply.mediaUrl) {
    mediaUrls.push(reply.mediaUrl);
  }

  // Split text into chunks if needed
  const textChunks = text.length > 0 ? chunkMessage(text) : [""];

  // Send first chunk with first media (if any)
  const firstChunk = textChunks[0];
  const firstMedia = mediaUrls[0];

  if (firstChunk || firstMedia) {
    const sentMessage = await originalMessage.reply({
      content: firstChunk || undefined,
      files: firstMedia ? [firstMedia] : undefined,
    });

    results.push({
      messageId: sentMessage.id,
      channelId: sentMessage.channelId,
      timestamp: sentMessage.createdAt,
    });

    if (isVerbose()) {
      logVerbose(
        `Discord reply sent: ${firstChunk.slice(0, 50)}${firstChunk.length > 50 ? "..." : ""}`
      );
    }
  }

  // Send remaining text chunks
  for (const chunk of textChunks.slice(1)) {
    const sentMessage = await originalMessage.reply({
      content: chunk,
    });

    results.push({
      messageId: sentMessage.id,
      channelId: sentMessage.channelId,
      timestamp: sentMessage.createdAt,
    });
  }

  // Send remaining media
  for (const mediaUrl of mediaUrls.slice(1)) {
    const sentMessage = await originalMessage.reply({
      files: [mediaUrl],
    });

    results.push({
      messageId: sentMessage.id,
      channelId: sentMessage.channelId,
      timestamp: sentMessage.createdAt,
    });
  }

  return results;
}

/**
 * Sends a message to a Discord channel (not a reply).
 * Used by the `warelay send` command.
 * 
 * @param channel - The channel to send to
 * @param content - The message content
 * @param mediaUrls - Optional media attachments
 */
export async function sendDiscordMessage(
  channel: TextChannel | DMChannel | ThreadChannel,
  content: string,
  mediaUrls: string[] = [],
): Promise<DiscordSendResult[]> {
  const results: DiscordSendResult[] = [];
  const textChunks = content.length > 0 ? chunkMessage(content) : [""];

  // Send first chunk with first media
  const firstChunk = textChunks[0];
  const firstMedia = mediaUrls[0];

  if (firstChunk || firstMedia) {
    const sentMessage = await channel.send({
      content: firstChunk || undefined,
      files: firstMedia ? [firstMedia] : undefined,
    });

    results.push({
      messageId: sentMessage.id,
      channelId: sentMessage.channelId,
      timestamp: sentMessage.createdAt,
    });
  }

  // Send remaining chunks
  for (const chunk of textChunks.slice(1)) {
    const sentMessage = await channel.send({ content: chunk });
    results.push({
      messageId: sentMessage.id,
      channelId: sentMessage.channelId,
      timestamp: sentMessage.createdAt,
    });
  }

  // Send remaining media
  for (const mediaUrl of mediaUrls.slice(1)) {
    const sentMessage = await channel.send({ files: [mediaUrl] });
    results.push({
      messageId: sentMessage.id,
      channelId: sentMessage.channelId,
      timestamp: sentMessage.createdAt,
    });
  }

  return results;
}
```

---

### Task 7: Create Event Handlers

**File:** `src/discord/events.ts` (CREATE NEW FILE)

```typescript
/**
 * Discord event handlers for the relay (auto-reply) functionality.
 * Converts Discord messages to MsgContext and invokes the core reply logic.
 */

import { ChannelType, type Client, type Message } from "discord.js";
import { getReplyFromConfig } from "../auto-reply/reply.js";
import type { MsgContext } from "../auto-reply/templating.js";
import { loadConfig } from "../config/config.js";
import { danger, isVerbose, logVerbose, success } from "../globals.js";
import { getChildLogger } from "../logging.js";
import { resolveDiscordConfig, type DiscordRuntimeConfig } from "./client.js";
import { sendDiscordReply } from "./send.js";
import type { NormalizedDiscordMessage } from "./types.js";

/**
 * Strips bot mentions from message content.
 * Discord mentions look like <@123456789> or <@!123456789> (with nickname).
 */
export function stripBotMention(content: string, botUserId: string): string {
  const mentionRegex = new RegExp(`<@!?${botUserId}>`, "g");
  return content.replace(mentionRegex, "").trim();
}

/**
 * Normalizes a Discord message into a consistent format.
 * Returns null if the message should be ignored.
 */
export function normalizeMessage(
  message: Message,
  botUserId: string,
  config: DiscordRuntimeConfig,
): NormalizedDiscordMessage | null {
  // Ignore messages from bots (including ourselves)
  if (message.author.bot) {
    return null;
  }

  const isDM = message.channel.type === ChannelType.DM;
  const isThread = 
    message.channel.type === ChannelType.PublicThread ||
    message.channel.type === ChannelType.PrivateThread;
  const isMention = !isDM && message.mentions.has(botUserId);

  // In channels, only respond if mentioned (when mentionOnly is true)
  if (!isDM && config.mentionOnly && !isMention) {
    return null;
  }

  // Check allowlists (empty list = allow all)
  const userId = message.author.id;
  const channelId = message.channelId;
  const guildId = message.guildId;

  if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(userId)) {
    if (isVerbose()) {
      logVerbose(`Discord: ignoring message from non-allowed user ${userId}`);
    }
    return null;
  }

  if (config.allowedChannels.length > 0 && !config.allowedChannels.includes(channelId)) {
    if (isVerbose()) {
      logVerbose(`Discord: ignoring message from non-allowed channel ${channelId}`);
    }
    return null;
  }

  if (guildId && config.allowedGuilds.length > 0 && !config.allowedGuilds.includes(guildId)) {
    if (isVerbose()) {
      logVerbose(`Discord: ignoring message from non-allowed guild ${guildId}`);
    }
    return null;
  }

  // Clean the message content (strip bot mention if in a channel)
  let content = message.content ?? "";
  if (!isDM && isMention) {
    content = stripBotMention(content, botUserId);
  }

  return {
    userId,
    userTag: message.author.tag,
    channelId,
    guildId,
    messageId: message.id,
    content,
    isDM,
    isMention,
    isThread,
    threadId: isThread ? channelId : null,
    timestamp: message.createdAt,
    rawMessage: message,
  };
}

/**
 * Converts a normalized Discord message to a MsgContext for the auto-reply system.
 */
export function toMsgContext(msg: NormalizedDiscordMessage): MsgContext {
  return {
    Body: msg.content,
    From: msg.userId,
    To: msg.channelId,
    MessageSid: msg.messageId,
    // We could add more fields here for templating if needed:
    // GuildId: msg.guildId,
    // ThreadId: msg.threadId,
    // UserTag: msg.userTag,
  };
}

/**
 * Handles an incoming Discord message.
 * This is the main entry point for message processing.
 */
export async function handleDiscordMessage(
  message: Message,
  botUserId: string,
  config: DiscordRuntimeConfig,
  logger: ReturnType<typeof getChildLogger>,
): Promise<void> {
  const normalized = normalizeMessage(message, botUserId, config);
  
  if (!normalized) {
    return; // Message should be ignored
  }

  const ctx = toMsgContext(normalized);
  const cfg = loadConfig();

  logger.info(
    {
      userId: normalized.userId,
      userTag: normalized.userTag,
      channelId: normalized.channelId,
      guildId: normalized.guildId,
      isDM: normalized.isDM,
      contentLength: normalized.content.length,
    },
    "Discord inbound message",
  );

  // Log to console for visibility
  const source = normalized.isDM ? "DM" : `#${normalized.channelId}`;
  console.log(`\n[Discord ${source}] ${normalized.userTag}: ${normalized.content}`);

  try {
    // Send typing indicator while we process
    // Discord typing indicator lasts ~10 seconds, we refresh it if needed
    let typingInterval: NodeJS.Timeout | undefined;
    
    const startTyping = async () => {
      try {
        await message.channel.sendTyping();
        // Refresh typing every 8 seconds (it lasts ~10 seconds)
        typingInterval = setInterval(async () => {
          try {
            await message.channel.sendTyping();
          } catch {
            // Ignore typing errors
          }
        }, 8000);
      } catch {
        // Ignore typing errors
      }
    };

    const stopTyping = () => {
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = undefined;
      }
    };

    // Get reply from the core auto-reply system
    const reply = await getReplyFromConfig(
      ctx,
      {
        onReplyStart: startTyping,
      },
      cfg,
    );

    stopTyping();

    // Check if we got a reply
    if (!reply || (!reply.text && !reply.mediaUrl && !reply.mediaUrls?.length)) {
      if (isVerbose()) {
        logVerbose("Discord: no reply configured or returned");
      }
      return;
    }

    // Send the reply
    const results = await sendDiscordReply(normalized.rawMessage, reply);

    logger.info(
      {
        userId: normalized.userId,
        channelId: normalized.channelId,
        replyLength: reply.text?.length ?? 0,
        hasMedia: Boolean(reply.mediaUrl || reply.mediaUrls?.length),
        messagesSent: results.length,
      },
      "Discord reply sent",
    );

    // Log to console
    const replyPreview = reply.text 
      ? reply.text.slice(0, 100) + (reply.text.length > 100 ? "..." : "")
      : "<media only>";
    console.log(success(`↩️  ${replyPreview}`));

  } catch (error) {
    logger.error(
      {
        userId: normalized.userId,
        channelId: normalized.channelId,
        error: String(error),
      },
      "Discord reply failed",
    );
    console.error(danger(`Failed to reply: ${String(error)}`));
  }
}

/**
 * Registers the messageCreate event handler on a Discord client.
 */
export function registerDiscordHandlers(
  client: Client,
  botUserId: string,
  config: DiscordRuntimeConfig,
  logger: ReturnType<typeof getChildLogger>,
): void {
  client.on("messageCreate", async (message) => {
    await handleDiscordMessage(message, botUserId, config, logger);
  });
}
```

---

### Task 8: Create Provider Entry Point

**File:** `src/discord/index.ts` (CREATE NEW FILE)

```typescript
/**
 * Discord provider entry point.
 * Exports the main monitoring function and utilities.
 */

import { getChildLogger } from "../logging.js";
import { danger, info, logVerbose } from "../globals.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { createAndLoginDiscordClient, resolveDiscordConfig } from "./client.js";
import { registerDiscordHandlers } from "./events.js";
import type { DiscordMonitorOptions } from "./types.js";

// Re-export types and utilities that might be needed externally
export { createDiscordClient, resolveDiscordConfig } from "./client.js";
export { sendDiscordMessage, sendDiscordReply } from "./send.js";
export type * from "./types.js";

/**
 * Starts the Discord provider relay.
 * Connects to Discord, registers event handlers, and listens for messages.
 * 
 * This is the main entry point called by `warelay relay --provider discord`.
 */
export async function monitorDiscordProvider(
  options: Partial<DiscordMonitorOptions> = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const verbose = options.verbose ?? false;
  const logger = getChildLogger({ module: "discord-relay" });

  try {
    // Resolve configuration
    const config = resolveDiscordConfig();
    
    if (verbose) {
      logVerbose("Discord config resolved:");
      logVerbose(`  - mentionOnly: ${config.mentionOnly}`);
      logVerbose(`  - replyInThread: ${config.replyInThread}`);
      logVerbose(`  - allowedUsers: ${config.allowedUsers.length || "all"}`);
      logVerbose(`  - allowedChannels: ${config.allowedChannels.length || "all"}`);
      logVerbose(`  - allowedGuilds: ${config.allowedGuilds.length || "all"}`);
    }

    // Create and login client
    runtime.log(info("Connecting to Discord..."));
    const { client, botUserId, botTag } = await createAndLoginDiscordClient();
    
    runtime.log(info(`✅ Logged in as ${botTag}`));
    logger.info({ botUserId, botTag }, "Discord client logged in");

    // Register event handlers
    registerDiscordHandlers(client, botUserId, config, logger);

    // Set up graceful shutdown
    const shutdown = async () => {
      runtime.log(info("\n👋 Shutting down Discord relay..."));
      logger.info("Discord relay shutting down");
      client.destroy();
      runtime.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    // Handle abort signal if provided
    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        void shutdown();
      });
    }

    // Log ready message
    runtime.log(
      info(
        "📡 Listening for Discord messages. " +
        (config.mentionOnly ? "Mention @" + botTag + " in channels or DM me. " : "") +
        "Ctrl+C to stop."
      )
    );

    // Keep the process running
    // The client maintains its own WebSocket connection
    await new Promise(() => {
      // Never resolves - we run until killed
    });

  } catch (error) {
    logger.error({ error: String(error) }, "Discord provider failed");
    runtime.error(danger(`Discord relay failed: ${String(error)}`));
    runtime.exit(1);
  }
}
```

---

### Task 9: Update CLI Program

**File:** `src/cli/program.ts`

You need to make several changes to this file:

**Step 9.1:** Add import for Discord provider (near the top with other imports):

```typescript
// Add this import near the other provider imports
import { monitorDiscordProvider } from "../discord/index.js";
```

**Step 9.2:** Update the `relay` command to support Discord.

Find the `.command("relay")` section and update it:

```typescript
program
  .command("relay")
  .description("Auto-reply to inbound messages (auto-selects web or twilio)")
  .option("--provider <provider>", "auto | web | twilio | discord", "auto")  // ADD discord
  // ... rest of options stay the same ...
```

Then, in the action handler, add the Discord case. Find where it handles providers and add:

```typescript
// Add this block before the Twilio case, after the web provider handling:

if (providerPref === "discord") {
  try {
    await monitorDiscordProvider({ verbose: Boolean(opts.verbose) }, defaultRuntime);
    return;
  } catch (err) {
    defaultRuntime.error(
      danger(`Discord relay failed: ${String(err)}. Check DISCORD_BOT_TOKEN.`),
    );
    defaultRuntime.exit(1);
  }
}
```

**Step 9.3:** Update the `send` command to support Discord.

Find the `.command("send")` section and update:

```typescript
.option("--provider <provider>", "Provider: twilio | web | discord", "twilio")
```

In the send action, you'll need to add Discord handling in `src/commands/send.ts` as well.

---

### Task 10: Update Environment Helpers

**File:** `src/env.ts`

Add a helper function to check for Discord environment variables:

```typescript
/**
 * Ensures Discord environment variables are set.
 * Throws an error if DISCORD_BOT_TOKEN is missing.
 */
export function ensureDiscordEnv(): void {
  if (!process.env.DISCORD_BOT_TOKEN) {
    throw new Error(
      "DISCORD_BOT_TOKEN environment variable is required for Discord provider. " +
      "Get your token from https://discord.com/developers/applications"
    );
  }
}
```

---

### Task 11: Update Send Command

**File:** `src/commands/send.ts`

Add Discord support to the send command. Add this import:

```typescript
import { Client, GatewayIntentBits } from "discord.js";
import { sendDiscordMessage } from "../discord/send.js";
```

Then add Discord handling in the main function (look for where it handles different providers):

```typescript
if (opts.provider === "discord") {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN not set");
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  await client.login(token);

  try {
    const channel = await client.channels.fetch(opts.to);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${opts.to} not found or is not a text channel`);
    }

    if (opts.dryRun) {
      runtime.log(success(`[dry-run] discord send -> ${opts.to}: ${opts.message}`));
      return;
    }

    const results = await sendDiscordMessage(
      channel as TextChannel,
      opts.message,
      opts.media ? [opts.media] : [],
    );

    if (opts.json) {
      runtime.log(JSON.stringify(results, null, 2));
    } else {
      runtime.log(success(`Sent message to ${opts.to} (${results.length} message(s))`));
    }
  } finally {
    client.destroy();
  }
  return;
}
```

---

### Task 12: Update Documentation

**File:** `.env.example`

Add Discord configuration:

```bash
# Discord (for --provider discord)
DISCORD_BOT_TOKEN=your-discord-bot-token-here
```

**File:** `README.md`

Add a section about Discord:

```markdown
## Discord Provider

### Setup

1. Create a Discord application at https://discord.com/developers/applications
2. Add a bot and copy the token
3. Enable MESSAGE CONTENT INTENT in Bot settings
4. Add the bot to your server using OAuth2 URL Generator (scope: bot, permissions: Send Messages, Read Message History)
5. Set `DISCORD_BOT_TOKEN` in your environment

### Usage

```bash
# Start the Discord relay
warelay relay --provider discord --verbose

# Send a message to a channel
warelay send --provider discord --to <channel-id> --message "Hello!"
```

### Configuration

In `~/.warelay/warelay.json`:

```json5
{
  discord: {
    mentionOnly: true,        // Only respond to @mentions in channels (default: true)
    replyInThread: true,      // Reply in threads when applicable (default: true)
    allowedUsers: ["123..."], // Optional: only allow specific user IDs
    allowedChannels: ["456..."], // Optional: only allow specific channel IDs
    allowedGuilds: ["789..."],   // Optional: only allow specific server IDs
  },
  inbound: {
    reply: {
      mode: "command",
      command: ["claude", "{{Body}}"],
      // ... rest of your auto-reply config
    }
  }
}
```
```

---

## Testing Your Implementation

### Manual Testing Checklist

Before considering the implementation complete, verify these scenarios:

#### Basic Connectivity
- [ ] Bot logs in successfully (`✅ Logged in as BotName#1234`)
- [ ] Bot appears online in Discord server
- [ ] No errors in console after startup

#### DM Handling
- [ ] Bot responds to direct messages
- [ ] Response uses configured auto-reply (Claude or static text)
- [ ] Long responses are chunked correctly (test with 3000+ chars)

#### Channel Mentions
- [ ] Bot ignores messages without @mention (when mentionOnly: true)
- [ ] Bot responds to @BotName messages
- [ ] Bot mention is stripped from the message content
- [ ] Response appears in the same channel

#### Thread Handling
- [ ] Bot responds in threads when message is in a thread
- [ ] Bot doesn't create new threads unexpectedly

#### Access Control
- [ ] allowedUsers works (test with allowed and non-allowed user)
- [ ] allowedChannels works (test in allowed and non-allowed channel)
- [ ] allowedGuilds works (if you have access to multiple servers)

#### Error Handling
- [ ] Bot handles missing permissions gracefully
- [ ] Bot reconnects after network issues (disconnect WiFi briefly)
- [ ] Bot logs errors clearly

### Unit Tests

Create these test files:

**File:** `src/discord/send.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { chunkMessage, DISCORD_MAX_MESSAGE_LENGTH } from "./send.js";

describe("chunkMessage", () => {
  it("returns single chunk for short messages", () => {
    const result = chunkMessage("Hello world");
    expect(result).toEqual(["Hello world"]);
  });

  it("splits long messages at newlines", () => {
    const longText = "a".repeat(1500) + "\n" + "b".repeat(1000);
    const result = chunkMessage(longText);
    expect(result.length).toBe(2);
    expect(result[0]).toBe("a".repeat(1500) + "\n");
    expect(result[1]).toBe("b".repeat(1000));
  });

  it("splits at spaces when no newlines available", () => {
    const longText = "word ".repeat(500);
    const result = chunkMessage(longText);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MAX_MESSAGE_LENGTH);
    }
  });

  it("handles messages exactly at limit", () => {
    const exactText = "a".repeat(DISCORD_MAX_MESSAGE_LENGTH);
    const result = chunkMessage(exactText);
    expect(result).toEqual([exactText]);
  });
});
```

**File:** `src/discord/events.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { stripBotMention } from "./events.js";

describe("stripBotMention", () => {
  const botId = "123456789";

  it("removes standard mention", () => {
    const content = "<@123456789> hello";
    expect(stripBotMention(content, botId)).toBe("hello");
  });

  it("removes nickname mention", () => {
    const content = "<@!123456789> hello";
    expect(stripBotMention(content, botId)).toBe("hello");
  });

  it("removes multiple mentions", () => {
    const content = "<@123456789> test <@123456789> message";
    expect(stripBotMention(content, botId)).toBe("test  message");
  });

  it("preserves other user mentions", () => {
    const content = "<@123456789> hello <@987654321>";
    expect(stripBotMention(content, botId)).toBe("hello <@987654321>");
  });

  it("trims whitespace", () => {
    const content = "   <@123456789>   hello   ";
    expect(stripBotMention(content, botId)).toBe("hello");
  });
});
```

Run tests with:
```bash
pnpm test src/discord/
```

---

## Common Gotchas and Troubleshooting

### "message.content is empty"

**Cause:** MESSAGE CONTENT INTENT not enabled.

**Fix:**
1. Go to Discord Developer Portal → Your App → Bot
2. Enable "MESSAGE CONTENT INTENT" under Privileged Gateway Intents
3. Make sure your code includes `GatewayIntentBits.MessageContent`

### "Cannot read property 'id' of null" on client.user

**Cause:** Trying to access client.user before the client is ready.

**Fix:** Wait for the "ready" event or use the login helper that waits:
```typescript
const { client, botUserId } = await createAndLoginDiscordClient();
```

### Bot doesn't respond in DMs

**Cause:** Missing `Partials.Channel` in client options.

**Fix:** Ensure client has:
```typescript
partials: [Partials.Channel]
```

### "Missing Access" or "Missing Permissions" errors

**Cause:** Bot doesn't have permission in that channel.

**Fix:**
1. Check the bot's role has "Send Messages" and "View Channel" permissions
2. Check channel-specific permission overrides
3. Reinvite bot with correct OAuth2 permissions

### Messages taking too long / typing disappears

**Cause:** Typing indicator only lasts ~10 seconds.

**Fix:** The implementation refreshes typing every 8 seconds. If Claude takes longer, this should handle it. If you still see issues, reduce the interval to 5 seconds.

### Rate limit errors

**Cause:** Sending too many messages too quickly.

**Fix:** discord.js handles rate limits automatically, but if you're testing aggressively:
1. Add delays between tests
2. Don't spam the bot
3. The library will queue and retry automatically

### Bot responds to itself

**Cause:** Not filtering bot messages.

**Fix:** The implementation checks `message.author.bot` first. Make sure this check is present:
```typescript
if (message.author.bot) return;
```

---

## Future Enhancements

These are NOT part of the initial implementation but could be added later:

### Slash Commands
Add `/ask <question>` slash command as an alternative to @mentions.

### Per-Channel Configuration
Allow different auto-reply configs per channel or guild.

### Media Support
Download Discord attachments and pass them to Claude for analysis.

### Thread-Scoped Sessions
Add `session.scope: "per-thread"` for thread-isolated conversations.

### Reactions as Feedback
Add 👍/👎 reactions and track user satisfaction.

### Message Editing
When Claude's response is updated (streaming), edit the Discord message instead of sending new ones.

---

## Summary

You're adding Discord as a provider to warelay. The key insight is that the core auto-reply logic (`getReplyFromConfig`) is provider-agnostic - it just needs a `MsgContext` and returns a `ReplyPayload`. Your job is to:

1. Listen for Discord messages
2. Convert them to `MsgContext`
3. Call `getReplyFromConfig`
4. Send the response back

The implementation follows the same patterns as the existing Web provider (`src/web/auto-reply.ts`). When in doubt, look at how that file does things.

**Total estimated time:** 3-4 hours for a working implementation, plus testing time.

**Questions?** Read the code in `src/web/auto-reply.ts` and `src/auto-reply/reply.ts` - they're well-documented and show the patterns you need to follow.
