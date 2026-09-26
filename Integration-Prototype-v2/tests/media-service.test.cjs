const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
process.env.DID_API_KEY = "test-did-key";
const media = require("../server/media-service.cjs");

function response(body, { status = 200, type = "application/json" } = {}) {
  return new Response(type === "application/json" ? JSON.stringify(body) : body, {
    status, headers: { "Content-Type": type }
  });
}

test("temporary ElevenLabs clone is deleted after speech generation", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    if (String(url).endsWith("/voices/add")) return response({ voice_id: "voice-test" });
    if (String(url).includes("/text-to-speech/voice-test")) return response("mp3-data", { type: "audio/mpeg" });
    if (String(url).endsWith("/voices/voice-test") && options.method === "DELETE") return response({ status: "ok" });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const speech = await media.createClonedSpeech(Buffer.from("voice"), "audio/webm", "I would ask before deciding.");
    assert.ok(speech.length > 0);
    assert.ok(calls.some(call => call.url.endsWith("/voices/voice-test") && call.method === "DELETE"));
  } finally { global.fetch = originalFetch; }
});

test("D-ID image, audio and talk are cleaned after video download", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const href = String(url); const method = options.method || "GET";
    calls.push({ url: href, method });
    if (href.endsWith("/images") && method === "POST") return response({ id: "image-test", url: "https://assets.test/image.jpg" }, { status: 201 });
    if (href.endsWith("/audios") && method === "POST") return response({ id: "audio-test", url: "https://assets.test/audio.mp3" }, { status: 201 });
    if (href.endsWith("/talks") && method === "POST") return response({ id: "talk-test" }, { status: 201 });
    if (href.endsWith("/talks/talk-test") && method === "GET") return response({ status: "done", result_url: "https://assets.test/result.mp4" });
    if (href === "https://assets.test/result.mp4") return response("video-data", { type: "video/mp4" });
    if (method === "DELETE") return response({}, { status: href.includes("/talks/") ? 200 : 204 });
    throw new Error(`Unexpected request: ${href}`);
  };
  try {
    const video = await media.createTalkingAvatar(Buffer.from("image"), "image/jpeg", Buffer.from("audio"), "audio/mpeg");
    assert.ok(video.length > 0);
    for (const resource of ["talks/talk-test", "audios/audio-test", "images/image-test"]) {
      assert.ok(calls.some(call => call.url.endsWith(resource) && call.method === "DELETE"), `${resource} was not deleted`);
    }
  } finally { global.fetch = originalFetch; }
});
