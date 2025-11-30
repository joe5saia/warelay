import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { request } from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { resolveProfilePaths } from "../config/runtime.js";
import { detectMime, extensionForMime } from "./mime.js";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes

export function getMediaDir() {
  return resolveProfilePaths().mediaDir;
}

export async function ensureMediaDir() {
  const dir = getMediaDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanOldMedia(ttlMs = DEFAULT_TTL_MS) {
  await ensureMediaDir();
  const mediaDir = getMediaDir();
  const entries = await fs.readdir(mediaDir).catch(() => []);
  const now = Date.now();
  await Promise.all(
    entries.map(async (file) => {
      const full = path.join(mediaDir, file);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) return;
      if (now - stat.mtimeMs > ttlMs) {
        await fs.rm(full).catch(() => {});
      }
    }),
  );
}

function looksLikeUrl(src: string) {
  return /^https?:\/\//i.test(src);
}

/**
 * Download media to disk while capturing the first few KB for mime sniffing.
 */
async function downloadToFile(
  url: string,
  dest: string,
  headers?: Record<string, string>,
): Promise<{ headerMime?: string; sniffBuffer: Buffer; size: number }> {
  return await new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      if (!res.statusCode || res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode ?? "?"} downloading media`));
        return;
      }
      let total = 0;
      const sniffChunks: Buffer[] = [];
      let sniffLen = 0;
      const out = createWriteStream(dest);
      res.on("data", (chunk) => {
        total += chunk.length;
        if (sniffLen < 16384) {
          sniffChunks.push(chunk);
          sniffLen += chunk.length;
        }
        if (total > MAX_BYTES) {
          req.destroy(new Error("Media exceeds 5MB limit"));
        }
      });
      pipeline(res, out)
        .then(() => {
          const sniffBuffer = Buffer.concat(
            sniffChunks,
            Math.min(sniffLen, 16384),
          );
          const rawHeader = res.headers["content-type"];
          const headerMime = Array.isArray(rawHeader)
            ? rawHeader[0]
            : rawHeader;
          resolve({
            headerMime,
            sniffBuffer,
            size: total,
          });
        })
        .catch(reject);
    });
    req.on("error", reject);
    req.end();
  });
}

export type SavedMedia = {
  id: string;
  path: string;
  size: number;
  contentType?: string;
};

export async function saveMediaSource(
  source: string,
  headers?: Record<string, string>,
  subdir = "",
): Promise<SavedMedia> {
  const mediaDir = getMediaDir();
  const dir = subdir ? path.join(mediaDir, subdir) : mediaDir;
  await fs.mkdir(dir, { recursive: true });
  await cleanOldMedia();
  const id = crypto.randomUUID();
  if (looksLikeUrl(source)) {
    const tempDest = path.join(dir, `${id}.tmp`);
    const { headerMime, sniffBuffer, size } = await downloadToFile(
      source,
      tempDest,
      headers,
    );
    const mime = detectMime({
      buffer: sniffBuffer,
      headerMime,
      filePath: source,
    });
    const ext =
      extensionForMime(mime) ?? path.extname(new URL(source).pathname);
    const finalDest = path.join(dir, ext ? `${id}${ext}` : id);
    await fs.rename(tempDest, finalDest);
    return { id, path: finalDest, size, contentType: mime };
  }
  // local path
  const stat = await fs.stat(source);
  if (!stat.isFile()) {
    throw new Error("Media path is not a file");
  }
  if (stat.size > MAX_BYTES) {
    throw new Error("Media exceeds 5MB limit");
  }
  const buffer = await fs.readFile(source);
  const mime = detectMime({ buffer, filePath: source });
  const ext = extensionForMime(mime) ?? path.extname(source);
  const dest = path.join(dir, ext ? `${id}${ext}` : id);
  await fs.writeFile(dest, buffer);
  return { id, path: dest, size: stat.size, contentType: mime };
}

export async function saveMediaBuffer(
  buffer: Buffer,
  contentType?: string,
  subdir = "inbound",
): Promise<SavedMedia> {
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error("Media exceeds 5MB limit");
  }
  const dir = path.join(getMediaDir(), subdir);
  await fs.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  const mime = detectMime({ buffer, headerMime: contentType });
  const ext = extensionForMime(mime);
  const dest = path.join(dir, ext ? `${id}${ext}` : id);
  await fs.writeFile(dest, buffer);
  return { id, path: dest, size: buffer.byteLength, contentType: mime };
}
