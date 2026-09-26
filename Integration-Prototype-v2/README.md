# Another Me Resilient Integration Prototype v2

This folder is a separate copy of the six-stage integration test with service-specific loading, timeout, error and fallback handling. Earlier prototype folders remain unchanged. The normal URL uses server-side OpenAI generation. Append `?mode=mock` for clearly labelled simulated text without OpenAI profile/generation calls. Nothing is written to a database or browser storage.

The experience opens with the Week 9 assignment title and a short caption for each stage. Finishing Stage 6 displays a development-status screen that separates working, partially working and still-in-development features. Camera consent is demonstrated with one explicit Enable Camera action rather than a redundant two-step prompt.

## Run

From the `another-me` repository root:

```powershell
node Integration-Prototype-v2/server/index.cjs
```

Open `http://127.0.0.1:4181/` for the real integration or `http://127.0.0.1:4181/?mode=mock` for mock AI text. Use Chrome or Edge on localhost. Transcription remains a separate OpenAI choice in either mode. Stage 5 separately asks before sending the longest available participant recording to ElevenLabs and before sending the supplied image plus generated speech to D-ID. The integration server reads `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` and `DID_API_KEY` from its environment, `Integration-Prototype-v2/.env.local`, or the existing repository-root `.env.local`, then must be restarted. `OPENAI_MODEL` is optional. `INTEGRATION_PORT` can change the port. Never commit a real `.env.local` file. Opening another preview port, such as `4173`, will not connect to these backend routes.

Run synthetic tests with:

```powershell
node Integration-Prototype-v2/tests/journey.test.cjs
node Integration-Prototype-v2/tests/resilience.test.cjs
node Integration-Prototype-v2/tests/openai-adapter.test.cjs
node Integration-Prototype-v2/tests/server.test.cjs
node Integration-Prototype-v2/tests/media-service.test.cjs
```

## Resilience state system

Each operation has an independent record in `sessionState.operations` with exactly one of: `idle`, `loading`, `success`, `timeout`, `error` or `fallback`. `runOperation()` prevents duplicate requests, attaches an abort controller, applies a service timeout, preserves earlier participant data, writes technical detail only to the developer console and renders calm recovery controls in an `aria-live` region. Back, Skip, End Experience, View My Data and Delete Session remain usable while a request is running.

| Operation | Browser timeout |
| --- | ---: |
| Camera permission | 20 seconds |
| Microphone permission | 20 seconds |
| OpenAI transcription | 45 seconds |
| OpenAI identity profile | 60 seconds |
| OpenAI prediction | 60 seconds |
| OpenAI proxy response | 60 seconds |
| OpenAI fictional generation | 60 seconds |
| ElevenLabs clone and speech | 180 seconds |
| D-ID animation | 360 seconds |

The server additionally limits OpenAI calls to 90 seconds, ElevenLabs clone creation to 60 seconds, ElevenLabs speech to 90 seconds, each D-ID upload/create request to 60 seconds, each D-ID poll to 30 seconds, D-ID job polling to four minutes and the completed-video download to 60 seconds. D-ID cleanup requests run in parallel so they do not add three sequential waits. Browser timeout values can be overridden before `script.js` loads with `globalThis.__ANOTHER_ME_TIMEOUTS__` for automated tests.

Fallbacks preserve the recording when transcription fails, preserve the last valid profile when OpenAI analysis fails, retain generated text when ElevenLabs fails, and retain a still portrait plus cloned audio when D-ID fails. If both media services fail, Stage 5 remains usable with the still portrait and text or text alone. Mock outputs are visibly marked and are never reported as successful live API results.

## Development-only simulations

Simulation controls are enabled only on localhost with `dev=1`; they do not render in the participant interface. Use a URL such as:

```text
http://127.0.0.1:4181/?dev=1&simulate=transcription:timeout
```

Supported scenarios are `slow-response`, `timeout`, `network-error`, `permission-denial`, `empty-api-response`, `elevenlabs-failure`, `did-failure` and `complete-media-failure`. Target a service with `simulate=identity:network-error`, combine scenarios with commas, or use the console helper while in development mode:

```js
__anotherMeDev.setScenario("did", "did-failure");
__anotherMeDev.clearScenario("did");
__anotherMeDev.states();
__anotherMeDev.timeoutValues();
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

The visual contents of a supplied image are not analyzed for personality. D-ID uses the image only for the separately consented animation step. Instant-clone quality depends strongly on the sample: ElevenLabs recommends longer clean recordings than a single short answer, so this prototype can sound approximate. Talking-double speech is limited to three concise sentences to reduce render time. Stage 6 returns a structured fictional memory with participant fragments separated from 2-3 concrete AI-invented details; every invented detail must appear in the memory and must not appear in the supplied answers.

API failures show a specific safe error and retain completed fallbacks. Append `?fail=openai`, `?fail=transcription`, `?fail=elevenlabs` or `?fail=did` to simulate failures. A D-ID failure preserves cloned audio instead of silently switching to standard speech. Synthetic tests do not consume vendor credits; a participant must complete the consented browser flow to verify the live account plans, media quality and provider moderation.
