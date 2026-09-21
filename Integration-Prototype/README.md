# Another Me Integration Prototype

This folder is a separate six-stage integration test. Earlier prototype folders remain unchanged. The default journey is **mock AI mode**: it needs no API key unless the participant separately opts into real transcription, and simulated outputs are labelled mock. Nothing is written to a database or browser storage.

## Run

From the `another-me` repository root:

```powershell
node Integration-Prototype/server/index.cjs
```

Open `http://127.0.0.1:4180/` for the mock AI journey. Use Chrome or Edge on `localhost` for camera and microphone tests. **Transcription is a separate real OpenAI request even in mock mode**, made only after you explicitly select Allow OpenAI Transcription. Once allowed, Stage 3 recordings transcribe automatically on stop and the recognised words feed the profile. For real profile construction, prediction, proxy response and fictional generation, open `http://127.0.0.1:4180/?mode=real`. The integration server reads `OPENAI_API_KEY` from its server environment, `Integration-Prototype/.env.local`, or the existing repository-root `.env.local` (in that order), then must be restarted. `OPENAI_MODEL` is optional. `INTEGRATION_PORT` can change the port. Never commit a real `.env.local` file. The server whitelists `index.html`, `style.css` and `script.js`, so it cannot serve credentials or server modules. Opening another preview port, such as `4173`, will not connect to this integration endpoint.

Run synthetic tests with:

```powershell
node Integration-Prototype/tests/journey.test.cjs
node Integration-Prototype/tests/server.test.cjs
```

## Read-only integration map

| Reference | Adapted function | Integrated stage |
| --- | --- | --- |
| `webcam-test/index.html` | User-facing `getUserMedia`, mirrored preview, mirrored JPEG canvas capture, track cleanup | 1 |
| `microphone-test/index.html` and `microphone-test/server.cjs` | `MediaRecorder`, audio playback, MIME selection, request-based transcription | 2 and optional voice answers in 3 |
| `identity-logic-test` | Copied strict schemas, validators, Responses API profile and prediction prompts into this folder's `server` directory | 3 and 4 |
| `interaction-test` | Six-stage pacing, source labels, review controls, uncertainty wording, session-data inspection | Throughout |
| Root `test-elevenlabs.mjs`, `clone-voice.mjs`, `test-did.mjs` | **Reference only.** These standalone scripts use sample assets and do not provide safe, per-session cleanup routes. No participant image/audio is sent to them. | 5 uses still image + text, or opt-in standard browser speech |

## Data and consent

Camera, microphone, transcription, proxy response, fictional generation, voice-cloning preference and face-animation preference are separate choices. Voice cloning and facial animation are **not connected**; their preference controls do not call those services. Standard browser audio is also separate and optional. Consented transcription sends only the selected recording through the server to OpenAI. Real-mode profile and generation calls send readable answers when chosen. The server does not save temporary files, so there is no server cleanup endpoint to call. External provider retention is outside this local prototype's control. If transcription is unavailable, the voice recording remains in the session, but its contents cannot support an inference until transcription succeeds; the participant can retry without typing.

Deleting a session stops all media tracks, aborts in-flight requests, revokes object URLs and clears the in-memory state. It never touches files. Closing the page also releases active media. Back navigation preserves confirmed answers; changing supplied text invalidates downstream AI outputs so they cannot silently use stale evidence.

The visual contents of a supplied image are **not** analyzed. The profile can cite that an image was supplied and use the participant's story, but it does not infer personality from appearance. Mock fiction invents a clearly marked ordinary detail; without image analysis, the prototype cannot prove that a similar detail is absent from an arbitrary photograph. The browser's speech synthesis, when allowed, is a standard voice, not a clone.

API failures show a specific safe error and retain the recording for retry. Append `?fail=transcription` in mock mode or `&fail=transcription` in real mode to simulate transcription failure without a paid request. `&fail=openai` simulates other real-mode AI failures. The optional ElevenLabs and D-ID failure checks verify that neither service is called and that Stage 5 remains usable as still image/text; they do not test live vendor APIs.
