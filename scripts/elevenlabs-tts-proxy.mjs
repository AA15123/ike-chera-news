/**
 * Local ElevenLabs TTS proxy for the static digest site.
 * Run: ELEVENLABS_API_KEY=... node scripts/elevenlabs-tts-proxy.mjs
 *
 * Never commit API keys. The browser calls this server; the key stays server-side.
 */
import http from "node:http";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PORT = Number(process.env.ELEVENLABS_PROXY_PORT || 8787);
const API_KEY = process.env.ELEVENLABS_API_KEY || "";
/** Default: ElevenLabs “Rachel” — override with ELEVENLABS_VOICE_ID */
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

async function validateElevenLabsKey() {
  if (!API_KEY) {
    return { keyValid: false, keyCheck: "missing" };
  }
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      method: "GET",
      headers: { "xi-api-key": API_KEY, Accept: "application/json" },
    });
    if (res.ok) {
      return { keyValid: true, keyCheck: "ok" };
    }
    const t = await res.text().catch(() => "");
    let code = "invalid";
    if (res.status === 401) code = "unauthorized";
    return { keyValid: false, keyCheck: code, keyHttpStatus: res.status, keyHint: t.slice(0, 160) };
  } catch (e) {
    return { keyValid: false, keyCheck: "network_error", keyHint: String(e.message || e).slice(0, 200) };
  }
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function audio(res, status, buf, contentType = "audio/mpeg") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": buf.length,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(buf);
}

async function readBody(req, maxBytes = 200_000) {
  const chunks = [];
  let n = 0;
  for await (const chunk of req) {
    n += chunk.length;
    if (n > maxBytes) throw new Error("Body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function elevenLabsTts(text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY,
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 400)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    const v = await validateElevenLabsKey();
    json(res, 200, {
      ok: true,
      hasKey: Boolean(API_KEY),
      keyValid: v.keyValid,
      keyCheck: v.keyCheck,
      keyHttpStatus: v.keyHttpStatus,
      voiceId: VOICE_ID,
      port: PORT,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    createReadStream(join(ROOT, "index.html")).pipe(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/tts") {
    if (!API_KEY) {
      json(res, 500, { error: "Missing ELEVENLABS_API_KEY in the environment for this proxy." });
      return;
    }
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}");
      const text = String(body.text || "").trim();
      if (!text) {
        json(res, 400, { error: "Missing text" });
        return;
      }
      const mp3 = await elevenLabsTts(text);
      audio(res, 200, mp3, "audio/mpeg");
    } catch (e) {
      json(res, 502, { error: String(e.message || e) });
    }
    return;
  }

  json(res, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ElevenLabs TTS proxy listening on http://127.0.0.1:${PORT}`);
  console.log(`Health: http://127.0.0.1:${PORT}/health`);
  if (!API_KEY) console.warn("Warning: ELEVENLABS_API_KEY is not set — /tts will fail.");
});
