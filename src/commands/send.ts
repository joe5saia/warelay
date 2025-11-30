import type { CliDeps } from "../cli/deps.js";
import { createAndLoginDiscordClient } from "../discord/client.js";
import { type SendableChannel, sendDiscordMessage } from "../discord/send.js";
import { ensureDiscordEnv } from "../env.js";
import { info } from "../globals.js";
import type { RuntimeEnv } from "../runtime.js";
import type { Provider } from "../utils.js";

export async function sendCommand(
  opts: {
    to: string;
    message: string;
    wait: string;
    poll: string;
    provider: Provider;
    json?: boolean;
    dryRun?: boolean;
    media?: string;
    serveMedia?: boolean;
  },
  deps: CliDeps,
  runtime: RuntimeEnv,
) {
  deps.assertProvider(opts.provider);
  const waitSeconds = Number.parseInt(opts.wait, 10);
  const pollSeconds = Number.parseInt(opts.poll, 10);

  if (Number.isNaN(waitSeconds) || waitSeconds < 0) {
    throw new Error("Wait must be >= 0 seconds");
  }
  if (Number.isNaN(pollSeconds) || pollSeconds <= 0) {
    throw new Error("Poll must be > 0 seconds");
  }

  if (opts.provider === "web") {
    if (opts.dryRun) {
      runtime.log(
        `[dry-run] would send via web -> ${opts.to}: ${opts.message}${opts.media ? ` (media ${opts.media})` : ""}`,
      );
      return;
    }
    if (waitSeconds !== 0) {
      runtime.log(info("Wait/poll are Twilio-only; ignored for provider=web."));
    }
    const res = await deps
      .sendMessageWeb(opts.to, opts.message, {
        verbose: false,
        mediaUrl: opts.media,
      })
      .catch((err) => {
        runtime.error(`❌ Web send failed: ${String(err)}`);
        throw err;
      });
    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            provider: "web",
            to: opts.to,
            messageId: res.messageId,
            mediaUrl: opts.media ?? null,
          },
          null,
          2,
        ),
      );
    }
    return;
  }

  if (opts.provider === "discord") {
    ensureDiscordEnv(runtime);
    if (opts.dryRun) {
      runtime.log(
        `[dry-run] would send via discord -> ${opts.to}: ${opts.message}${opts.media ? ` (media ${opts.media})` : ""}`,
      );
      return;
    }
    const { client } = await createAndLoginDiscordClient();
    try {
      const channel = await client.channels.fetch(opts.to);
      if (!channel || !channel.isTextBased()) {
        throw new Error(
          `Channel ${opts.to} not found or not text-capable for Discord`,
        );
      }
      if (!("send" in channel) || typeof channel.send !== "function") {
        throw new Error(
          `Channel ${opts.to} is not send-capable (missing send method)`,
        );
      }

      const results = await sendDiscordMessage(
        channel as SendableChannel,
        opts.message,
        opts.media ? [opts.media] : [],
      );
      if (opts.json) {
        runtime.log(JSON.stringify(results, null, 2));
      } else {
        runtime.log(
          info(
            `Sent Discord message to ${opts.to} (${results.length} chunk${results.length === 1 ? "" : "s"})`,
          ),
        );
      }
    } finally {
      client.destroy();
    }
    return;
  }

  if (opts.dryRun) {
    runtime.log(
      `[dry-run] would send via twilio -> ${opts.to}: ${opts.message}${opts.media ? ` (media ${opts.media})` : ""}`,
    );
    return;
  }

  let mediaUrl: string | undefined;
  if (opts.media) {
    mediaUrl = await deps.resolveTwilioMediaUrl(opts.media, {
      serveMedia: Boolean(opts.serveMedia),
      runtime,
    });
  }

  const result = await deps.sendMessage(
    opts.to,
    opts.message,
    { mediaUrl },
    runtime,
  );
  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          provider: "twilio",
          to: opts.to,
          sid: result?.sid ?? null,
          mediaUrl: mediaUrl ?? null,
        },
        null,
        2,
      ),
    );
  }
  if (!result) return;
  if (waitSeconds === 0) return;
  await deps.waitForFinalStatus(
    result.client,
    result.sid,
    waitSeconds,
    pollSeconds,
    runtime,
  );
}
