import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import dotenv from "dotenv";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const media = name => path.join(here, "..", "media-samples", name);
dotenv.config({ path: path.join(here, "..", "..", ".env.local") });
console.log("Sending request to ElevenLabs...");
if (!process.env.ELEVENLABS_API_KEY) {
  throw new Error("ElevenLabs API key was not found.");
}

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function main() {
  const audio = await client.textToSpeech.convert(
    "21m00Tcm4TlvDq8ikWAM",
    {
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
      text: "Hello. This is a test for the Another Me project.",
    }
  );
  console.log("Audio received. Saving file...");

  const arrayBuffer = await new Response(audio).arrayBuffer();
  fs.writeFileSync(media("output.mp3"), Buffer.from(arrayBuffer));

  console.log("Success: output.mp3 has been created.");
}

main().catch(console.error);