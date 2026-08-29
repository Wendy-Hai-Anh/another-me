import fs from "node:fs";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const didApiKey = process.env.DID_API_KEY;

const imagePath = "portrait.jpg";
const imageMimeType = "image/jpeg";

const audioPath = "cloned-voice-test.mp3";
const audioMimeType = "audio/mpeg";

if (!didApiKey) {
  throw new Error("D-ID API key was not found.");
}

if (!fs.existsSync(imagePath)) {
  throw new Error(`${imagePath} was not found.`);
}

if (!fs.existsSync(audioPath)) {
  throw new Error(`${audioPath} was not found.`);
}

const authorizationHeaders = {
  Authorization: `Basic ${didApiKey}`,
};

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function readResponse(response, operation) {
  const responseText = await response.text();

  let responseData;

  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = responseText;
  }

  if (!response.ok) {
    throw new Error(
      `${operation} failed (${response.status}): ${
        typeof responseData === "string"
          ? responseData
          : JSON.stringify(responseData)
      }`
    );
  }

  return responseData;
}

async function uploadImage() {
  console.log("1. Uploading portrait to D-ID...");

  const imageForm = new FormData();

  imageForm.append(
    "image",
    new Blob([fs.readFileSync(imagePath)], {
      type: imageMimeType,
    }),
    imagePath
  );

  const response = await fetch("https://api.d-id.com/images", {
    method: "POST",
    headers: authorizationHeaders,
    body: imageForm,
  });

  const result = await readResponse(response, "Image upload");
  const imageUrl = result.url || result.source_url;

  if (!imageUrl) {
    throw new Error(
      `D-ID uploaded the image but did not return a URL: ${JSON.stringify(result)}`
    );
  }

  console.log("Portrait uploaded.");
  return imageUrl;
}

async function uploadAudio() {
  console.log("2. Uploading cloned audio to D-ID...");

  const audioForm = new FormData();

  audioForm.append(
    "audio",
    new Blob([fs.readFileSync(audioPath)], {
      type: audioMimeType,
    }),
    audioPath
  );

  const response = await fetch("https://api.d-id.com/audios", {
    method: "POST",
    headers: authorizationHeaders,
    body: audioForm,
  });

  const result = await readResponse(response, "Audio upload");
  const audioUrl = result.url || result.audio_url || result.source_url;

  if (!audioUrl) {
    throw new Error(
      `D-ID uploaded the audio but did not return a URL: ${JSON.stringify(result)}`
    );
  }

  console.log("Audio uploaded.");
  return audioUrl;
}

async function createTalk(imageUrl, audioUrl) {
  console.log("3. Creating D-ID Talk...");

  const response = await fetch("https://api.d-id.com/talks", {
    method: "POST",
    headers: {
      ...authorizationHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
    source_url: imageUrl,
    script: {
    type: "audio",
    audio_url: audioUrl,
  },
  name: "Another Me D-ID Test",
}),
  });

  const result = await readResponse(response, "Talk creation");

  if (!result.id) {
    throw new Error(
      `D-ID did not return a Talk ID: ${JSON.stringify(result)}`
    );
  }

  console.log(`Talk created: ${result.id}`);
  return result.id;
}

async function waitForTalk(talkId) {
  console.log("4. Waiting for D-ID to render the video...");

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    await wait(3000);

    const response = await fetch(
      `https://api.d-id.com/talks/${talkId}`,
      {
        method: "GET",
        headers: authorizationHeaders,
      }
    );

    const result = await readResponse(response, "Talk status check");

    console.log(`Status check ${attempt}: ${result.status}`);

    if (result.status === "done") {
      if (!result.result_url) {
        throw new Error("Talk finished but no result URL was returned.");
      }

      return result.result_url;
    }

    if (
      result.status === "error" ||
      result.status === "failed" ||
      result.status === "rejected"
    ) {
      throw new Error(
        `D-ID video generation failed: ${JSON.stringify(result)}`
      );
    }
  }

  throw new Error("D-ID did not finish within three minutes.");
}

async function downloadVideo(resultUrl) {
  console.log("5. Downloading finished video...");

  const response = await fetch(resultUrl);

  if (!response.ok) {
    throw new Error(
      `Video download failed (${response.status}).`
    );
  }

  const videoBuffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync("did-talk-1.mp4", videoBuffer);

  console.log("Success: did-talk-1.mp4 was created.");
}

async function main() {
  const imageUrl = await uploadImage();
  const audioUrl = await uploadAudio();
  const talkId = await createTalk(imageUrl, audioUrl);
  const resultUrl = await waitForTalk(talkId);

  await downloadVideo(resultUrl);
}

main().catch((error) => {
  console.error("\nD-ID error:");
  console.error(error.message);
});