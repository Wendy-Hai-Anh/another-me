import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import dotenv from "dotenv";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const media = name => path.join(here, "..", "media-samples", name);
dotenv.config({ path: path.join(here, "..", "..", ".env.local"), quiet: true });

const apiKey = process.env.ELEVENLABS_API_KEY;
const samplePath = media("voice-sample.m4a");

if (!apiKey) {
  throw new Error("ElevenLabs API key was not found.");
}

if (!fs.existsSync(samplePath)) {
  throw new Error(`${samplePath} was not found.`);
}

async function main() {
  console.log("Uploading voice sample and creating clone...");

  const form = new FormData();
  const sample = fs.readFileSync(samplePath);

  form.append("name", "Another Me Test Voice");
  form.append(
    "files",
    new Blob([sample], { type: "audio/mp4" }),
    samplePath
  );

  const cloneResponse = await fetch(
    "https://api.elevenlabs.io/v1/voices/add",
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
      body: form,
    }
  );

  if (!cloneResponse.ok) {
    throw new Error(
      `Voice cloning failed (${cloneResponse.status}): ${await cloneResponse.text()}`
    );
  }

  const clone = await cloneResponse.json();
  const voiceId = clone.voice_id;

  fs.writeFileSync(media("voice-id.txt"), voiceId);
  console.log("Voice clone created.");
  console.log("Generating test speech...");

  const client = new ElevenLabsClient({ apiKey });

  const audio = await client.textToSpeech.convert(voiceId, {
  modelId: "eleven_multilingual_v2",
  outputFormat: "mp3_44100_128",
  text: "Hello. This is a temporary version of my voice created for the Another Me project.",
  voiceSettings: {
    stability: 0.65,
    similarityBoost: 1,
    style: 0.0,
    useSpeakerBoost: true,
    },
  });

  const arrayBuffer = await new Response(audio).arrayBuffer();
  fs.writeFileSync(
    media("cloned-voice-test.mp3"),
    Buffer.from(arrayBuffer)
  );

  console.log("Success: cloned-voice-test.mp3 was created.");
  console.log("The voice ID was saved in voice-id.txt.");
}

main().catch((error) => {
  console.error(error.message);
});