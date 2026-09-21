# Another Me Integration Prototype

This folder is a separate six-stage integration test. Earlier prototype folders remain unchanged. The normal URL uses server-side OpenAI generation. Append `?mode=mock` for clearly labelled simulated text without OpenAI profile/generation calls. Nothing is written to a database or browser storage.

## Run

From the `another-me` repository root:

```powershell
node Integration-Prototype/server/index.cjs
```

Open `http://127.0.0.1:4180/` for the real integration or `http://127.0.0.1:4180/?mode=mock` for mock AI text. Use Chrome or Edge on localhost. Transcription remains a separate OpenAI choice in either mode. Stage 5 separately asks before sending the longest available participant recording to ElevenLabs and before sending the supplied image plus generated speech to D-ID. The integration server reads `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` and `DID_API_KEY` from its environment, `Integration-Prototype/.env.local`, or the existing repository-root `.env.local`, then must be restarted. `OPENAI_MODEL` is optional. `INTEGRATION_PORT` can change the port. Never commit a real `.env.local` file. Opening another preview port, such as `4173`, will not connect to these backend routes.

Run synthetic tests with:

```powershell
node Integration-Prototype/tests/journey.test.cjs
node Integration-Prototype/tests/server.test.cjs
node Integration-Prototype/tests/media-service.test.cjs
```

## Read-only integration map

| Reference | Adapted function | Integrated stage |
| --- | --- | --- |
| `webcam-test/index.html` | User-facing `getUserMedia`, mirrored preview, mirrored JPEG canvas capture, track cleanup | 1 |
| `microphone-test/index.html` and `microphone-test/server.cjs` | `MediaRecorder`, audio playback, MIME selection, request-based transcription | 2 and optional voice answers in 3 |
| `identity-logic-test` | Copied strict schemas, validators, Responses API profile and prediction prompts into this folder's `server` directory | 3 and 4 |
| `interaction-test` | Six-stage pacing, source labels, review controls, uncertainty wording, session-data inspection | Throughout |
| Root `test-elevenlabs.mjs`, `clone-voice.mjs`, `test-did.mjs` | Adapted server-side instant cloning, speech generation, image/audio upload, D-ID talk polling and downloaded-video playback. The standalone scripts remain unchanged. | 5 uses cloned first-person speech and, for a suitable portrait, a talking image |

## Data and consent

Camera, microphone, transcription, proxy response, fictional generation, voice cloning and face animation are separate choices. Consented voice cloning sends the longest recorded answer to ElevenLabs, generates one first-person MP3, then requests immediate deletion of the temporary ElevenLabs voice. Consented face animation sends the supplied JPEG/PNG and cloned MP3 to D-ID, downloads the resulting MP4 into browser memory, then requests deletion of the D-ID talk, uploaded image and uploaded audio. D-ID may retain uploaded resources for its documented temporary-storage period if cleanup cannot be completed; provider processing and billing remain outside this local prototype's control. A portrait without a detectable face falls back to cloned audio and a still image. Standard browser speech is used only when separately allowed.

Deleting a session stops all media tracks, aborts in-flight requests, revokes object URLs and clears the in-memory state. It never touches files. Closing the page also releases active media. Back navigation preserves confirmed answers; changing supplied text invalidates downstream AI outputs so they cannot silently use stale evidence.

The visual contents of a supplied image are not analyzed for personality. D-ID uses the image only for the separately consented animation step. Instant-clone quality depends strongly on the sample: ElevenLabs recommends longer clean recordings than a single short answer, so this prototype can sound approximate. Mock fiction remains clearly marked; real Stage 5 and 6 generation also receives the temporary profile, participant corrections, prediction and comparison context.

API failures show a specific safe error and retain completed fallbacks. Append `?fail=openai`, `?fail=transcription`, `?fail=elevenlabs` or `?fail=did` to simulate failures. A D-ID failure preserves cloned audio instead of silently switching to standard speech. Synthetic tests do not consume vendor credits; a participant must complete the consented browser flow to verify the live account plans, media quality and provider moderation.
