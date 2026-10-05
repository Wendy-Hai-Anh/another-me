const elevenBase = "https://api.elevenlabs.io/v1";
const didBase = "https://api.d-id.com";
const didPollIntervalMs = Math.max(250, Number(process.env.DID_POLL_INTERVAL_MS) || 3_000);
const didRenderTimeoutMs = Math.max(30_000, Number(process.env.DID_RENDER_TIMEOUT_MS) || 330_000);

const audioExtensions = new Map([
  ["audio/webm", "webm"], ["audio/ogg", "ogg"], ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"], ["audio/wav", "wav"], ["audio/x-wav", "wav"]
]);
const imageExtensions = new Map([["image/jpeg", "jpg"], ["image/png", "png"]]);

function externalError(provider, message, statusCode = 502) {
  return Object.assign(new Error(message), { provider, publicMessage: message, statusCode });
}

async function timedFetch(url, options, timeoutMs, provider, operation) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw externalError(provider, `${provider} timed out during ${operation}.`, 504);
    throw externalError(provider, `${provider} could not be reached during ${operation}.`, 502);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response, provider, operation) {
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? `${provider} rejected the server API key or plan permission.`
      : response.status === 402
        ? `${provider} does not have enough credits for ${operation}.`
        : response.status === 429
          ? `${provider} rate limit reached. Try again later.`
          : `${provider} could not complete ${operation} (HTTP ${response.status}).`;
    throw externalError(provider, message, response.status >= 500 ? 502 : 422);
  }
  return data;
}

async function quietDelete(url, headers, provider) {
  try { await timedFetch(url, { method: "DELETE", headers }, 15_000, provider, "temporary resource cleanup"); } catch { /* Best-effort vendor cleanup. */ }
}

async function createClonedSpeech(audio, type, text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw externalError("ElevenLabs", "ELEVENLABS_API_KEY is missing on the integration server.", 503);
  const extension = audioExtensions.get(type);
  if (!extension) throw externalError("ElevenLabs", "This recording format cannot be used for voice cloning.", 415);
  if (!audio.length) throw externalError("ElevenLabs", "The selected voice recording is empty.", 400);
  if (typeof text !== "string" || !text.trim() || text.length > 3000) throw externalError("ElevenLabs", "The proxy speech text is empty or too long.", 400);

  const form = new FormData();
  form.append("name", `Another Me Temporary ${Date.now()}`);
  form.append("description", "Temporary voice clone for one consented Another Me prototype response.");
  form.append("files", new Blob([audio], { type }), `voice-sample.${extension}`);

  let voiceId = "";
  try {
    const cloneResponse = await timedFetch(`${elevenBase}/voices/add`, {
      method: "POST", headers: { "xi-api-key": apiKey }, body: form
    }, 60_000, "ElevenLabs", "temporary voice cloning");
    const clone = await readJson(cloneResponse, "ElevenLabs", "temporary voice cloning");
    voiceId = clone.voice_id || "";
    if (!voiceId) throw externalError("ElevenLabs", "ElevenLabs did not return a temporary voice ID.");

    const speechResponse = await timedFetch(`${elevenBase}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.trim(), model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.62, similarity_boost: 0.9, style: 0, use_speaker_boost: true }
      })
    }, 90_000, "ElevenLabs", "cloned speech generation");
    if (!speechResponse.ok) await readJson(speechResponse, "ElevenLabs", "cloned speech generation");
    const speech = Buffer.from(await speechResponse.arrayBuffer());
    if (!speech.length) throw externalError("ElevenLabs", "ElevenLabs returned empty cloned speech.");
    return speech;
  } finally {
    if (voiceId) await quietDelete(`${elevenBase}/voices/${encodeURIComponent(voiceId)}`, { "xi-api-key": apiKey }, "ElevenLabs");
  }
}

function didHeaders(extra = {}) {
  if (!process.env.DID_API_KEY) throw externalError("D-ID", "DID_API_KEY is missing on the integration server.", 503);
  return { Authorization: `Basic ${process.env.DID_API_KEY}`, ...extra };
}

async function uploadDidResource(kind, buffer, type, extension) {
  const form = new FormData();
  form.append(kind, new Blob([buffer], { type }), `temporary-${kind}.${extension}`);
  const response = await timedFetch(`${didBase}/${kind === "image" ? "images" : "audios"}`, {
    method: "POST", headers: didHeaders(), body: form
  }, 60_000, "D-ID", `${kind} upload`);
  const result = await readJson(response, "D-ID", `${kind} upload`);
  const url = result.url || result.source_url || result.audio_url;
  if (!url) throw externalError("D-ID", `D-ID uploaded the ${kind} but returned no temporary URL.`);
  return { id: result.id || "", url };
}

function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

function didStatusName(result) {
  return typeof result?.status === "string" ? result.status.toLowerCase() : "unknown";
}

function didFailureCode(result) {
  const failure = result?.error || result?.failure;
  if (typeof failure === "string") return failure.slice(0, 120);
  if (failure && typeof failure === "object") {
    return String(failure.kind || failure.code || failure.name || "provider_error").slice(0, 120);
  }
  return "provider_error";
}

async function readDidTalk(talkId) {
  const response = await timedFetch(`${didBase}/talks/${encodeURIComponent(talkId)}`, {
    headers: didHeaders()
  }, 30_000, "D-ID", "talking-avatar status check");
  return readJson(response, "D-ID", "talking-avatar status check");
}

async function createTalkingAvatar(image, imageType, audio, audioType) {
  const imageExtension = imageExtensions.get(imageType);
  if (!imageExtension) throw externalError("D-ID", "The avatar image must be a JPEG or PNG.", 415);
  if (audioType !== "audio/mpeg") throw externalError("D-ID", "The cloned avatar audio must be MP3.", 415);
  if (!image.length || !audio.length) throw externalError("D-ID", "The avatar image or cloned audio is empty.", 400);

  let uploadedImage = null;
  let uploadedAudio = null;
  let talkId = "";
  try {
    uploadedImage = await uploadDidResource("image", image, imageType, imageExtension);
    uploadedAudio = await uploadDidResource("audio", audio, audioType, "mp3");
    const talkResponse = await timedFetch(`${didBase}/talks`, {
      method: "POST",
      headers: didHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        source_url: uploadedImage.url,
        script: { type: "audio", audio_url: uploadedAudio.url },
        name: "Another Me Temporary Response"
      })
    }, 60_000, "D-ID", "talking-avatar creation");
    const talk = await readJson(talkResponse, "D-ID", "talking-avatar creation");
    talkId = talk.id || "";
    if (!talkId) throw externalError("D-ID", "D-ID did not return a talking-avatar job ID.");

    let resultUrl = "";
    let lastStatus = "created";
    let lastLoggedStatus = "";
    const animationDeadline = Date.now() + didRenderTimeoutMs;
    while (Date.now() < animationDeadline) {
      await wait(Math.min(didPollIntervalMs, Math.max(0, animationDeadline - Date.now())));
      const status = await readDidTalk(talkId);
      lastStatus = didStatusName(status);
      if (lastStatus !== lastLoggedStatus) {
        console.info(`[integration-api] D-ID talk ${talkId} status=${lastStatus}`);
        lastLoggedStatus = lastStatus;
      }
      if (lastStatus === "done") {
        resultUrl = status.result_url || "";
        if (!resultUrl) throw externalError("D-ID", "D-ID finished the animation but returned no video.", 502);
        break;
      }
      if (["error", "failed", "rejected"].includes(lastStatus)) {
        console.error(`[integration-api] D-ID talk ${talkId} failure=${didFailureCode(status)}`);
        throw externalError("D-ID", "D-ID rejected this animation. Try a clear, front-facing portrait or use the still portrait with cloned audio.", 422);
      }
    }
    if (!resultUrl) {
      // A queued job can finish on the deadline boundary, so check once more before falling back.
      const finalStatus = await readDidTalk(talkId);
      lastStatus = didStatusName(finalStatus);
      if (lastStatus === "done" && finalStatus.result_url) resultUrl = finalStatus.result_url;
    }
    if (!resultUrl) {
      throw externalError("D-ID", `D-ID remained ${lastStatus === "unknown" ? "queued" : lastStatus} for more than five minutes. The still portrait and cloned audio are still available.`, 504);
    }
    const videoResponse = await timedFetch(resultUrl, {}, 60_000, "D-ID", "completed video download");
    if (!videoResponse.ok) throw externalError("D-ID", "The completed D-ID video could not be downloaded.");
    const video = Buffer.from(await videoResponse.arrayBuffer());
    if (!video.length) throw externalError("D-ID", "D-ID returned an empty video.");
    return video;
  } finally {
    await Promise.allSettled([
      talkId ? quietDelete(`${didBase}/talks/${encodeURIComponent(talkId)}`, didHeaders(), "D-ID") : null,
      uploadedAudio?.id ? quietDelete(`${didBase}/audios/${encodeURIComponent(uploadedAudio.id)}`, didHeaders(), "D-ID") : null,
      uploadedImage?.id ? quietDelete(`${didBase}/images/${encodeURIComponent(uploadedImage.id)}`, didHeaders(), "D-ID") : null
    ].filter(Boolean));
  }
}

module.exports = { audioExtensions, createClonedSpeech, createTalkingAvatar, imageExtensions };
