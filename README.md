# Another Me

Another Me is a browser-based experience exploring how limited data can become an AI representation that appears to know, predict and speak for its user. From a photograph, recorded voice and progressively personal questions, the system builds a temporary algorithmic identity and presents it as a talking digital double. Participants can accept, correct, reject or delete it.

This is the v6 prototype ("Entering the Digital Double"), now the main project. Earlier prototypes and experiments are kept in `archive/`.

**Published site:** https://wendy-hai-anh.github.io/another-me/ (GitHub Pages). Without its AI server it runs as a labelled demonstration; see [docs/DEPLOY.md](docs/DEPLOY.md) to connect the live AI and for the privacy clean-up of old media.

## Project Layout

```text
another-me/
├─ public/              what the browser loads
│  ├─ index.html        page shell and build id (asset paths are relative, so it works under /another-me/)
│  ├─ css/v6.css        design system: themes per stage, labels, layouts
│  └─ js/
│     ├─ config.js      where the AI server is (the one line to edit when publishing)
│     ├─ script.js      session state, devices, provider calls (the engine)
│     ├─ v6.js          every screen, navigation, passages, notices (the interface)
│     └─ motion.js      the tunnel atmosphere (canvas)
├─ shared/              used by both the browser and the server
│  ├─ proxy-text.js     removes source references from the double's spoken script
│  └─ simulation-core.js  Stage 6 schema, scenario pool, evidence filtering
├─ server/              Node server: static files, OpenAI, ElevenLabs and D-ID adapters
├─ tests/               unit tests (npm test)
│  ├─ browser/          Playwright scripts (written for the earlier UI; see below)
│  └─ manual/           live simulation check, reference checksum check
├─ docs/                DEPLOY.md (publishing + privacy), storyboard, test report, reference checksums
├─ archive/             earlier prototypes, experiments and media samples (see archive/README.md)
├─ .github/workflows/  pages.yml: publishes public/ + shared/ to GitHub Pages on every push to main
├─ render.yaml          blueprint for hosting the AI server on Render
├─ .env.local           your API keys (never committed, never served)
└─ .env.example         names of the settings the server reads
```

## Run Locally

From `C:\Users\Wendy\another-me`:

```powershell
npm start
```

- Real integration: http://127.0.0.1:4187/
- Mock text journey: http://127.0.0.1:4187/?mode=mock
- Development simulations: http://127.0.0.1:4187/?dev=1

Use localhost in Chrome or Edge, not a file URL or static Live Server: API requests require this Node backend. If port 4187 is occupied, set `INTEGRATION_PORT` in this terminal before starting. Keep the terminal open. Only the files listed in `server/index.cjs` are served (`/`, `/css/*`, `/js/*`); `.env.local`, the server code and the archive are never reachable from the browser.

The server reads environment variables, then `.env.local` in the project root. Hosting settings (`ACCESS_CODE`, `ALLOWED_ORIGINS`, request limits, `PORT`) are described in [docs/DEPLOY.md](docs/DEPLOY.md). Restart the server after changing configuration. `.env.example` contains names only:

```text
OPENAI_API_KEY
OPENAI_MODEL
ELEVENLABS_API_KEY
DID_API_KEY
INTEGRATION_PORT
DID_POLL_INTERVAL_MS
DID_RENDER_TIMEOUT_MS
```

The existing model default is preserved; `OPENAI_MODEL` must support Responses API Structured Outputs. All provider requests and keys remain server-side. API capability indicators mean configuration exists, not that account credits, permissions, generation quality or latency have been verified.

## Experience

Build `v6-20261005-passages2`. The interface is one continuous descent into the participant's computational representation. `index.html` declares the build in a meta tag, cache-busts every asset with it, shows it in the Session menu and logs it to the console. On localhost an open tab compares its build with the server's page on focus and every minute; a stale tab shows a notice and only reloads (clearing in-memory data) when asked.

**Navigation.** One screen is one meaningful interaction; nothing is paginated. Forward is always the single footer primary button, whose label and action follow state (Use this image, Next question, Build my profile, Confront the contradiction, Compare our answers, Allow voice cloning, Would you have said this?, Finish…). When it cannot proceed it is disabled and a hint says why. Back is secondary; Skip is a quiet text action whose wording names what is skipped. Forward travel moves the current screen up and brings the next from below; Back reverses it (~760 ms within a stage; entering and moving between stages take ~1.9 s, pausing in an empty gap where the tunnel blooms in saturated, shifting colour behind the rising stage number). Scrolling, wheel and touch never trigger progression; long generated content simply scrolls inside the stage. Reduce motion (Session menu or OS setting) makes passages immediate. End and Delete cancel a passage at once. A vertical depth rail (01–06 plus a THRESHOLD node) replaces the progress bar. Every stage already reached is a link: clicking it travels up or down to that stage without erasing anything (Stage 3 reopens the profile if one exists; Stage 5 reopens the threshold until its permissions were answered). Hovering or focusing the rail reveals all labels over a fade of the stage colour so they stay readable above content.

**Atmosphere.** `motion.js` draws one tunnel adapted from the Neon Tunnel study: receding rings, longitudinal edges, data traces and a dark core, in cyan, violet and hot pink at rest (kept faint for readability) and a full neon spectrum with a bright portal during stage passages. Early stages are round, faint and slow; each stage interpolates towards denser, hexagonal, more enclosed geometry. Stage 4–5 add an offset "double" tunnel that converges once the double has answered; Stage 6 traces a path after the reveal. Pointer parallax is slight. The canvas never reads participant content or devices beyond the recording level; hidden tabs pause it.

**Type and colour.** Colours come from the mood board (cream #F7F4E8, pink #E33D96, green #5BCB5D, dark type #35255A, cyan detail) arranged by colour-wheel harmony. The background travels one analogous arc instead of being darkened with black: warm cream (intro) → blush cream (Stage 1) → light periwinkle-lilac (Stage 2) → dark blue with a soft violet field (Stage 3, where it turns) → indigo (4) → deep violet (5) → a very dark purple-pink (6). From Stage 3 a hole opens at the vanishing point: a deep tint of the stage colour with a long, soft falloff, drawn beneath the tunnel rings so they stay visible. It grows each stage (small in 3, wider in 4, nearly the whole screen in 5, everything in 6), and stage passages bloom progressively dimmer the deeper they go. Passages also grow more complex with depth, eased so the light stages stay simple (complexity 0 → .12 → .25 → .42 → threshold .52 → .6 → .8 for Stages 1–6): into Stage 1 a plain round tunnel in one colour (~1.5 s); into 2 a few streaks; into 3 flowing colour and a soft glow; into 4 the hexagon and a gentle twist; into 5 the full twist and a slow roll of the view; into 6 adds a counter-rotating inner tunnel, shockwave rings and a rose/cyan split (~2.9 s). A held-breath ending exists in motion.js for complexity above .85 and is not currently used. The atmosphere overlay steps back during passages so the tunnel is fully seen. Reduced motion still makes every passage instant. Each deep stage has two faint hue fields plus an even vignette from every edge; the footer no longer paints its own band. Each light stage's edges are tinted with the next hue. The intro portal previews that whole journey (cream → blush → lilac → periwinkle) on a fixed layer that fades out at the screen edges. The tunnel and its passages use only the rose-pink → violet → indigo → cyan-blue arc, with a warm cream core as the complement; green is kept for the "supplied by you" tag only. Tags: green supplied, pink inferred, cyan generated; recording and warnings are pink. Text tones are adjusted per theme so every colour passes 4.5:1 on every stage background (tests/contrast.test.cjs). Small labels use Silkscreen, body IBM Plex Sans and headings a serif; web fonts load from Google Fonts with system fallbacks. Consecutive labels sit in one row. The threshold before Stage 5 is numbered 05, and the stage number in a passage is drawn to suit the screen being left. On the three permission screens the consent button and its alternative (Don't let it speak for me / Use text only / Continue without a face) sit side by side in the footer, consent on the left. The live camera appears as a square beneath the session controls.

**Visual grammar.** Participant material is solid, off-white and left-edged (YOU SAID / TRANSCRIBED). Model material is translucent with a violet edge (MODEL INFERENCE / PREDICTION); generated material is pink (GENERATED). Uncertainty is dashed; contradictions, rejection, deletion and demonstrations use the single warm warning colour. Every tag carries a glyph and words, never colour alone. Corrections visibly change the model side (struck through, re-labelled CONTESTED / REJECTED / CONTEXT ADDED BY YOU, a short revision note and motion) and keep the participant's words beside it.

**Stages.** Stage 1 is an invitation plus one image (upload or mirrored camera; the image is never read for personality). Stages 2, 3 and 4 use one voice + words workspace: record/stop with timer, live waveform and state (ready, recording, transcribing, recorded, error), playback, record again, and an always-editable transcript; split on desktop, stacked on phones. Stopping a recording sends it straight to OpenAI for transcription (the record button says so); there is no separate confirm or consent step, and failures show Retry beside the words. Selected verdicts can be taken back by clicking them again. Building the profile shows what is happening, an elapsed timer and the answers being held; failures keep every answer and show a categorised, human-readable notice (configuration, quota, timeout, incomplete output, validation, connection) with a technical detail disclosure. The profile reveals WHAT YOU SAID beside WHAT THE MODEL CONCLUDED, then one screen per interpretation and per contradiction as THE MODEL versus YOU, with evidence in an inline disclosure (question numbers appear only as faint source notes). Stage 4 places the prediction beside the participant's answer, then compares them with the rating and explanation on the same screen.

The checkpoint between Stages 4 and 5 separates permission for:
1. An AI proxy response.
2. Sending the selected own-voice recording to ElevenLabs.
3. Sending a separately confirmed portrait and generated cloned audio to D-ID.

There are exactly three checkpoint screens, with no nested pager or sub-dialog: proxy permission; voice permission with sample selection/playback/recording; photo permission with the one live preview or captured portrait and confirmation. New recordings become the selected sample. Device errors appear beside their controls instead of stacking another panel. Nothing generates until requested. Text-only and Skip are always alternatives. Permissions can be revised from Stage 5. Cloned audio survives animation failure; standard speech is never silently substituted.

After the threshold, Stage 5 has two screens only. The response screen puts the question, the double's portrait or talking video (or an empty frame for text only), cloned-voice playback, a three-step generation list driven by real operation states (constructing response, preparing voice, creating the talking double; no percentages), and the generated answer together. If animation fails, the cloned audio stays, the failure is categorised (account restriction, credits, portrait rejected, timeout…) and only "Retry animation" is offered, which reuses the existing audio. "Stop waiting, keep what is ready" cancels a long D-ID queue. The review screen keeps "Would you have said this?", Accept / Correct / Reject, an inline correction field, Delete, and the judged answer together. Stage 6 shows the situation first, then renders the stored structured result as one passage (situation, decision and action, inner thought, possible words, consequence, uncertainty) with no field labels and no further model call, then a review screen (Yes / Partly / No / Unsure, explanation, reject, delete) and the final identity question. GENERATED · HYPOTHETICAL and "This never happened" stay visible throughout.

Stage 5 keeps evidence IDs in optional evidence notes, not in its visible or spoken script. `proxy-text.js` removes structured source citations, and rejects unresolved source narration before a paid voice request. The proxy prompt and schema descriptions explicitly reserve references for `evidence_ids`. D-ID uses that generated audio, not a separately narrated evidence list. Previously generated media is not silently regenerated.

## Stage 6 Contract

Disclosure and consent -> unfamiliar situation -> participant-controlled reveal -> hypothetical behavior -> optional evidence -> challenge -> final identity question.

`simulation-core.js` defines the strict schema, controlled scenario pool, evidence filtering, validation and explicit mock behavior. `server/simulation-service.cjs` contains `SIMULATION_PROMPT` and the Responses API adapter. `POST /api/simulation` returns `{ simulation }`.

Required output fields:

```text
scenario_id, scenario_title, scenario
predicted_decision, predicted_action, predicted_thought
predicted_dialogue (string or null), predicted_consequence
evidence [{ source_id, source, interpretation, type }]
generated_elements
contradictory_evidence [{ evidence_ids, description, participant_explanation }]
confidence, uncertainty_statement, alternative_action, unknowns
source_label = GENERATED
warning = This is a hypothetical AI-generated situation, not a report of a real event.
```

Every object uses `additionalProperties: false`. The validator checks schema shape, eligible source IDs/types, exact permitted scenario text, contradictions, uncertainty and low confidence for sparse or conflicting evidence. Sources retrieve actual answers by ID in the optional evidence panels, separated as SUPPLIED, INFERRED and UNKNOWN. The scenario, behavior, dialogue, consequence and imagined inner response are all GENERATED.

Source IDs are restricted to the eligible session sources in each request. Model evidence uses the same `source_id`, `source`, and `type` field names as the request; display labels are resolved server-side from valid ID/type pairs. Invalid IDs, wrong source types and malformed fields still fail validation. This avoids rejecting a valid citation solely because the model paraphrased a display label. Responses formatting follows the [official Structured Outputs contract](https://developers.openai.com/api/docs/guides/structured-outputs).

Committed answers, safe participant corrections and unrejected inferences are eligible. Rejected/superseded inferences, generated assumptions and detected sensitive content are excluded. Safe contradiction explanations are preserved. Profile/input changes invalidate the previous result without erasing it on a failed retry. One result is generated and revealed locally; the reveal never makes a second API call.

The safe scenario pool covers shared space, honest hobby feedback, asking for help, cancelled plans, shared credit and everyday boundaries. Previously discussed topics and used scenario IDs are excluded. The prototype reports when this finite pool is exhausted rather than claiming an old scenario is new.

## Architecture and Read-Only References

| Source | Adapted functions | v6 use |
| --- | --- | --- |
| `archive/prototypes/Integration-Prototype-v4` | Working six-stage state, labels, questions, profile/contradiction review, recording, server adapters, recovery controls and tests | Functional base, copied before editing |
| `D:\files` | v5 palette, digital-space typography and visual direction | New canvas/UI; reference files unchanged |
| v4 copies of webcam and microphone tests | Mirrored getUserMedia capture, MediaRecorder MIME selection, playback and transcription | Stages 1-4 and consent checkpoint |
| v4 copy of identity-logic test | Strict profile/prediction schemas and Responses prompts | Stages 3-4 |
| v4 interaction-test adaptations | Labels, uncertainty, consent, feedback and in-memory data controls | All stages |
| v4 media-service adapters | ElevenLabs temporary cloning and D-ID upload/poll/download/cleanup | Consented Stage 5 |

`script.js` retains the copied state/device/service implementation. `v6.js` owns every screen, the single state-aware forward control, vertical travel, inline notices, the threshold, the double and the simulation review; it overrides script.js render functions rather than changing its state or services. `motion.js` exposes stage presets, directional travel/cancellation, reaction events, pause/resume and dispose through one bounded-resolution animation loop. `proxy-text.js` shares script cleanup between the browser, proxy adapter and speech route.

Session data stays separate: supplied inputs, inferences/reviews, predictions/actual answers, proxy media and the new simulation. Reveal progress, simulation revision and simulation feedback are separate UI state. No database or localStorage stores participant information. Delete Session stops streams, aborts requests, revokes object URLs and clears browser-memory data/drafts. It does not delete files.

External providers receive data only after the relevant permission and action. Copied media adapters request deletion of temporary provider assets. Provider-side retention and already-started remote jobs cannot be guaranteed to stop instantly when a browser request is cancelled.

## Timeouts and Fallbacks

| Process | Browser timeout | Recovery |
| --- | ---: | --- |
| Camera / microphone | 20 s each | Retry; image upload or text |
| Transcription | 45 s | Keep audio; replay, retry or type/edit |
| Profile / prediction / proxy | 60 s each | Keep inputs and last valid output; retry, labelled mock or skip |
| New simulation | 150 s overall | Keep inputs/result; retry, labelled mock or skip |
| ElevenLabs | 180 s | Keep generated text; no automatic standard voice |
| D-ID | 480 s | Preserve cloned audio and still portrait; text if no audio |

Simulation generation allows at most two model calls, 60 seconds each, with one validation retry and a 150-second route deadline. The copied D-ID polling default is 330 seconds; per-upload/create timeouts are 60 seconds, polling calls 30 seconds and completed-video download 60 seconds. All operations preserve idle/loading/success/timeout/error/fallback state and suppress duplicate requests.

Mock mode generates labelled local profile/prediction/proxy/simulation text and does not call ElevenLabs or D-ID. Transcription remains a separately consented external action even in mock mode; type answers for a completely offline/no-key journey.

Development-only examples:

```text
/?dev=1&simulate=fiction:timeout
/?dev=1&simulate=transcription:network-error
/?dev=1&simulate=complete-media-failure
```

The inherited developer helper `__anotherMeDev` supports permission denial, slow response, timeout, network error, empty response, ElevenLabs/D-ID failures and complete media failure. No testing panel appears in normal participant mode.

## Tests

```powershell
npm test                    # every unit test, one file at a time
npm run site                # build the GitHub Pages folder into _site/ to preview it
npm run check:references    # archive and D:\files are still byte-identical to docs/reference-baseline.json
```

Two unit tests already failed before the reorganisation and still do: "D-ID failure preserves cloned audio…" (journey) expects older wording in `script.js`, and the server test expects `/api/transcribe` without a key to return 503 rather than 502.

`tests/manual/simulation-live-check.cjs` makes a real OpenAI call for Stage 6 and needs your keys. The Playwright scripts in `tests/browser/` (Edge + Playwright, server running) were written for the UI before the descent redesign and need updating before they are useful again; they write screenshots to `tests/browser/artifacts/` (git-ignored). They use native canvas/audio MediaStreams from `device-fixture.cjs`, not physical hardware.

See [docs/TEST-REPORT.md](docs/TEST-REPORT.md) for the earlier verification record (it describes the pre-redesign UI and old file locations). [docs/STORYBOARD.md](docs/STORYBOARD.md) is the historical v4 storyboard.

## Known Limits

- Repeated OpenAI output quality, live ElevenLabs/D-ID quality, account permissions and timing still need consented live checks. The 2026-10-03 report records one successful synthetic-text OpenAI check. The 2026-10-04 conversation/UI follow-up used no paid provider calls or participant biometrics.
- Edge's built-in fake camera intermittently failed on repeated startup/off/on during testing, despite successful isolated cycles. The UI keeps retry/upload/text routes and preserves inputs. The dock now reuses its video element and camera restart includes a bounded release/retry path; physical-camera verification is still required. Controlled stream fixtures are used for the repeatable browser UI suite, not presented as proof that the native-device issue is eliminated.
- Novelty and sensitive-content exclusion are conservative English lexical checks plus prompt constraints and source validation, not a comprehensive semantic or multilingual safety classifier. Broad matches can exclude harmless evidence; paraphrased earlier situations may evade the overlap check.
- Local mock simulation is explicitly rule-based demonstration content, not a live identity prediction. Live behavioral fields are model-generated from eligible session evidence.
- The six-situation pool can be exhausted on repeated retries. Sparse information still produces a hypothetical possibility with low confidence, not claimed knowledge.
- Automated tests cover several fixed viewport sizes and a 640x360 layout equivalent to 200% zoom from 1280x720. Physical touch hardware, actual browser zoom UI, screen-reader narration and real-device quality need manual testing.
- On phones, paired regions stack and longer screens scroll within the stage instead of becoming extra pages. A five-to-seven-minute completion time is a design aim, not a measured participant-study result.
