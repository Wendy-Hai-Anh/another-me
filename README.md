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
│  ├─ audio/            the four background-music tracks
│  └─ js/
│     ├─ config.js      where the AI server is (the one line to edit when publishing)
│     ├─ script.js      session state, devices, provider calls (the engine)
│     ├─ v6.js          every screen, the conversation, navigation, fallbacks (the interface)
│     ├─ music.js       background music: alternating tracks, ducking, the Music switch
│     └─ motion.js      the tunnel atmosphere (canvas)
├─ shared/              used by both the browser and the server
│  ├─ proxy-text.js     removes source references from the double's spoken script
│  └─ simulation-core.js  Stage 6 schema, fixed situation and scenario pool, evidence filtering
├─ server/              Node server: static files, OpenAI, ElevenLabs and D-ID adapters,
│                       conversation-service.cjs (image reading, replies, reading answers together),
│                       feedback-store.cjs (feedback form storage)
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

Build `v6-20261008-personalisation` (checkpoints of earlier builds: git tags `checkpoint/v6-before-conversation`, `checkpoint/v6-conversation-before-calibration` and `checkpoint/v6-calibration-before-personalisation`). On screens wider than 620 px every interface element is drawn at 90% (CSS `zoom` on the shell, dialogs and stage marker; the shell height is divided by the scale so it still fills the window). Phones keep 100%; the tunnel is not scaled. The interface is one continuous descent into the participant's computational representation. `index.html` declares the build in a meta tag, cache-busts every asset with it, shows it in the Session menu and logs it to the console. On localhost an open tab compares its build with the server's page on focus and every minute; a stale tab shows a notice and only reloads (clearing in-memory data) when asked.

**Navigation.** One screen is one meaningful interaction; nothing is paginated. Forward is always the single footer primary button, whose label and action follow state (Use this image, Send, Next situation, Continue to Stage 4, What would you actually say?, Allow voice cloning, Which part could have come from you?, Show me, Finish…). When it cannot proceed it is disabled and a hint says why. Back is secondary; Skip is a quiet text action whose wording names what is skipped. Forward travel moves the current screen up and brings the next from below; Back reverses it (~760 ms within a stage; entering and moving between stages take ~1.9 s, pausing in an empty gap where the tunnel blooms in saturated, shifting colour behind the rising stage number). Scrolling, wheel and touch never trigger progression; long generated content simply scrolls inside the stage. Reduce motion (Session menu or OS setting) makes passages immediate. End and Delete cancel a passage at once. A vertical depth rail (01–06 plus a THRESHOLD node) replaces the progress bar. Every stage already reached is a link: clicking it travels up or down to that stage without erasing anything (Stage 3 reopens the profile if one exists; Stage 5 reopens the threshold until its permissions were answered). Hovering or focusing the rail reveals all labels over a fade of the stage colour so they stay readable above content.

**Atmosphere.** `motion.js` draws one tunnel adapted from the Neon Tunnel study: receding rings, longitudinal edges, data traces and a dark core, in cyan, violet and hot pink at rest (kept faint for readability) and a full neon spectrum with a bright portal during stage passages. Early stages are round, faint and slow; each stage interpolates towards denser, hexagonal, more enclosed geometry. Stage 4–5 add an offset "double" tunnel that converges once the double has answered; Stage 6 traces a path after the reveal. Pointer parallax is slight. The canvas never reads participant content or devices beyond the recording level; hidden tabs pause it.

**Type and colour.** Colours come from the mood board (cream #F7F4E8, pink #E33D96, green #5BCB5D, dark type #35255A, cyan detail) arranged by colour-wheel harmony. The background travels one analogous arc instead of being darkened with black: warm cream (intro) → blush cream (Stage 1) → light periwinkle-lilac (Stage 2) → dark blue with a soft violet field (Stage 3, where it turns) → indigo (4) → deep violet (5) → a very dark purple-pink (6). From Stage 3 a hole opens at the vanishing point: a deep tint of the stage colour with a long, soft falloff, drawn beneath the tunnel rings so they stay visible. It grows each stage (small in 3, wider in 4, nearly the whole screen in 5, everything in 6), and stage passages bloom progressively dimmer the deeper they go. Passages also grow more complex with depth, eased so the light stages stay simple (complexity 0 → .12 → .25 → .42 → threshold .52 → .6 → .8 for Stages 1–6): into Stage 1 a plain round tunnel in one colour (~1.5 s); into 2 a few streaks; into 3 flowing colour and a soft glow; into 4 the hexagon and a gentle twist; into 5 the full twist and a slow roll of the view; into 6 adds a counter-rotating inner tunnel, shockwave rings and a rose/cyan split (~2.9 s). A held-breath ending exists in motion.js for complexity above .85 and is not currently used. The atmosphere overlay steps back during passages so the tunnel is fully seen. Reduced motion still makes every passage instant. Each deep stage has two faint hue fields plus an even vignette from every edge; the footer no longer paints its own band. Each light stage's edges are tinted with the next hue. The intro portal previews that whole journey (cream → blush → lilac → periwinkle) on a fixed layer that fades out at the screen edges. The tunnel and its passages use only the rose-pink → violet → indigo → cyan-blue arc, with a warm cream core as the complement; green is kept for the "supplied by you" tag only. Tags: green supplied, pink inferred, cyan generated; recording and warnings are pink. Text tones are adjusted per theme so every colour passes 4.5:1 on every stage background (tests/contrast.test.cjs). Small labels use Silkscreen, body IBM Plex Sans and headings a serif; web fonts load from Google Fonts with system fallbacks. Consecutive labels sit in one row. The threshold before Stage 5 is numbered 05, and the stage number in a passage is drawn to suit the screen being left. On the three permission screens the consent button and its alternative (Don't let it speak for me / Use text only / Continue without a face) sit side by side in the footer, consent on the left. The live camera appears as a square beneath the session controls.

**Visual grammar.** Participant material is solid, off-white and left-edged (YOU SAID / TRANSCRIBED). Model material is translucent with a violet edge (MODEL INFERENCE / PREDICTION); generated material is pink (GENERATED). Uncertainty is dashed; contradictions, rejection, deletion and demonstrations use the single warm warning colour. Every tag carries a glyph and words, never colour alone. Corrections visibly change the model side (struck through, re-labelled CONTESTED / REJECTED / CONTEXT ADDED BY YOU, a short revision note and motion) and keep the participant's words beside it.

**One conversational presence.** The website speaks as "I", one moment at a time: it says something, you answer (voice or text, with the transcript always editable), it thinks briefly (a short "thinking" beat you can skip with *Continue without waiting*), then it gives one brief response and you continue. A question, your input, an interpretation and its evidence are never shown together; evidence is always behind *Why do you think that?* (what you said / what I inferred / what I can't know). Anything spoken on your behalf is labelled GENERATED ON YOUR BEHALF · AI DOUBLE.

- **Stage 1.** "Choose an image that says something about you." Upload, camera, or *Describe an image instead*. After *Use this image* the system looks once (`/api/image-reading`, a ≤768 px JPEG): one visible observation, then a deliberately stretched SPECULATIVE FIRST IMPRESSION of what you might value, avoid or want others to see, drawn from what the image shows, its framing and your choice to share it, with a short "From …" line naming the detail it came from. It never reads faces, bodies, appearance or demographics; with little context it leaps from the choice itself. No question follows. The Stage 5 portrait is a separate asset.
- **Stage 2.** "What would I misunderstand about you if this image were all I had?" with a helper line. Here the system becomes grounded: it answers your words, not the image, and when your explanation points elsewhere it says so plainly ("I read the image as … Your explanation suggests …"). It never manufactures a correction: a brief answer like "It's my desk" leaves the first impression unaddressed, and without a Stage 1 reading there is nothing to revise. The reply (`/api/reply`) is one move: a brief acknowledgement, one specific follow-up (only when it resolves a real gap), or one SPECULATIVE AI INTERPRETATION: an assumption about you as a person (personality, routine, habit, behaviour, relationships, family or priorities) that your words hint at but do not state, never your answer said back (the server rejects summaries and requires a guess phrased about you), with *That fits* / *Partly, but you've stretched it* / *That isn't me* and an optional note. Whether the first impression was revised, partly supported, supported or not addressed is shown on the Stage 1 card and in *See my data*.
- **Stage 3.** The three situations, one at a time, each with only a brief acknowledgement (or a follow-up; at most one per question and two across Stages 2–3, never generic, always skippable). After the third, the answers are read together (`/api/synthesis`) while the model of you is built in the background. Interpretations here are a little more challenging than before (competing motives, accepted compromises, gaps between what someone values and what they would do), always grounded in concrete words. Then comes at most one bold reading and one review before Stage 4:
  - **The review.** The server first checks explicitly which two statements differ most, whether they concern the same priority, and whether the participant's own words already explain the difference. If a real, unexplained tension exists, the review shows one short, fair comparison restating both statements, one clear question, *Show what I said* (the exact excerpts), *You misunderstood*, and voice or text input; Skip is in the footer. Different choices are never called hypocrisy or inconsistency. If there is no tension, one genuine open question may be asked instead ("I don't know yet …"); if neither exists, there is no review. After the reply, `/api/review` gives one brief acknowledgement of how the reading changed, built from the explanation (or at most one clarification first if the explanation leaves a real ambiguity; a reply that gives no reason gets that clarification, never invented reasons). The outcome is recorded as depending on context, resolved, a misunderstanding, still open, or answered.
  - **Carried forward.** The explanation (and any clarification) becomes a supplied answer, the profile is rebuilt from it as Stage 4 begins, and a tension the participant explained or rejected is no longer treated as an open contradiction by predictions, the double or the scene. Skipping adds nothing and leaves the tension open; silence is never agreement.
  - *See how I built this* still opens the earlier profile review (interpretations and uncertainties) as an optional detour.
- **Stage 4.** The situation appears and the prediction is prepared at once ("Preparing a prediction · 00:08"), shown first as "I think you would tell them: '…'", then "What would you actually say?", then "Did I get your decision right, your reason right, both, or neither?" (*Both / Decision only / Reason only / Neither*, optional note). The prediction is never regenerated after you answer and your answer is never sent to make one. If evidence is insufficient or the service fails, the stage says so calmly and simply asks you.

**Personalisation.** More personal detail comes from better use of evidence, not more forceful claims. Every interpretation starts from a specific choice, reason or phrase the participant gave and then makes one believable step beyond it ("You sketch on the train, so you might…"; "You keep the promise, and you also want your manager to know what it cost you. You may want…"). The server rejects generic trait pairs ("you value relationships but also care about your career"), absolutes (always, never, everyone) and readings that drop a condition the participant stated (only with close friends, if it happened again, depending on the consequences). Very brief answers get no interpretation or tension, at most one open question. Each interpretation has one compact label and an optional *Why this interpretation?* panel: what you said, the connection I made, what remains unknown. Stage 4 predicts from the participant's own reasoning and register; the Stage 5 double first decides whether this person would agree, partly agree or refuse, then writes in their demonstrated style (it names that style in *What did it draw on?* and never uses a stock confrontation line their answers do not support); Stage 6 is a short scene (first reaction, a decision with a trade-off, their words, an action, a consequence) whose reasoning is recognisable from their answers plus exactly one invented decision or motive, both shown under *Why this interpretation?*. After the scene, an optional panel asks which detail felt specifically like them and where the AI made a leap they would not make, per part, separating the action, the motive and the wording; it stays with the fictional scene and never enters the profile. Rejected readings (and a tension called a misunderstanding) are sent as rejected_interpretations to the profile, the double and the scene, and are never used as evidence.

Rules carried through every stage: interpretations quote you exactly (checked on the server), never invent quotes, events or habits, never infer health, diagnoses, appearance or other sensitive traits, and never show confidence percentages. A rejected interpretation is excluded from everything that follows (only your own words about it travel on); partial or accepted ones travel as your reaction, not as fact. Reactions, corrections and the tension explanation become supplied answers; the model of you is rebuilt from them when next needed, or the last valid model is used with the exact answers it was built from.

The checkpoint between Stages 4 and 5 separates permission for:
1. An AI proxy response.
2. Sending the selected own-voice recording to ElevenLabs.
3. Sending a separately confirmed portrait and generated cloned audio to D-ID.

There are exactly three checkpoint screens, with no nested pager or sub-dialog: proxy permission; voice permission with sample selection/playback/recording; photo permission with the one live preview or captured portrait and confirmation. New recordings become the selected sample. Device errors appear beside their controls instead of stacking another panel. Nothing generates until requested. Text-only and Skip are always alternatives. Permissions can be revised from Stage 5. Cloned audio survives animation failure; standard speech is never silently substituted.

Before the threshold a message arrives: someone has volunteered you for an event without asking ("I told them you'd help. You're always the reliable one."), and "Your double will answer this message for you." After the three permissions the reply is generated at once: the exact message you would send back, in your style, with one specific decision. A single progress line with a real elapsed timer follows the steps ("Writing your double's reply" → "Creating your double's voice" → "Animating your double"), continuous across them and gone when ready. After 8 s of a voice or animation wait the footer offers *Continue with text* / *Continue with audio*. Fallbacks are automatic: animation failure → still portrait + cloned voice; voice failure → text, with an optional, clearly labelled *Play in a standard voice (not yours)*; text failure → one background retry, then the stage continues without a reply. The review asks "Which part could have come from you—and which part would you never say?": each sentence can be marked *Could be me* / *I'd never say this* or rewritten in your own words, and the whole reply can still be accepted, corrected, rejected or deleted. No explanation is required. Stage 6 begins without asking: "I have your words and some of your choices. Here is a situation you never gave me—and the version of you I made for it." It writes one fixed situation (recognition, and someone who helped saying they were overlooked) as a scene in the order a moment unfolds (first thought or feeling, the words said in public, the decision afterwards, one concrete action, the immediate consequence). FICTIONAL AI-GENERATED SCENE stays visible; if the live scene fails a prepared demonstration scene is shown and labelled as not AI. The last question is "Does this still feel like you?" (*Yes / Partly / No / Unsure*); after *Partly* or *No*, "What did this version of you get wrong?" (*The action / The thoughts / The way I spoke / The whole interpretation*, optional note). A fictional scene never becomes a memory or evidence.

**Failures and "What happened?".** Every wait is finite and every failure falls back on its own with one calm sentence (e.g. "The animation couldn't finish, so your double will continue with audio and a still image."). Specifics sit in a *What happened?* panel (Where / What happened / What the system did / What can help) that stays open across updates. It separates technical failures (connection, time limit, configuration, credits, validation) from missing information ("Not enough information", "No speech heard"), shows only a short error code, and never keys, request contents or stack traces. Recovery controls inside it (try the microphone, transcription or prediction again) are optional; the prediction can only be retried before you have answered. Results that arrive after you moved on are ignored and never replace the screen you are reading.

**Music.** Four supplied tracks in `public/audio/` play quietly and alternately (breathing, piano, breathing, piano) with a 5 s crossfade, starting only after *Enter*. The *Music on / Music off* switch sits beside *Session*; the choice is remembered in this browser (localStorage, the only thing stored there) and is never switched back on by the experience. Music is silent while recording, lowered under any audio or video on the page and under the standard voice, stops when the experience ends or is paused, and stays silent if the files cannot load.

**Feedback.** The final panel is a form: the four questions (one choice each, changeable), the stage at which the AI's version stopped feeling like you, "Was any label unclear?", an optional comment, and *Send feedback*. It stores only question ids, answers, comments and the build version (`POST /api/feedback`, no access code needed, 10 per hour per visitor). "Feedback sent—thank you" appears only after the server confirms storage; a retry reuses the same submission id so nothing is stored twice; on failure the form stays filled with *Try sending again* and *Download a copy*. In the serverless demonstration only the download is offered. Storage setup: [docs/DEPLOY.md](docs/DEPLOY.md#feedback-storage).

Stage 5 keeps evidence IDs in optional evidence notes, not in its visible or spoken script. `proxy-text.js` removes structured source citations, and rejects unresolved source narration before a paid voice request. The proxy prompt and schema descriptions explicitly reserve references for `evidence_ids`. D-ID uses that generated audio, not a separately narrated evidence list. Previously generated media is not silently regenerated.

## Stage 6 Contract

Disclosure and consent -> unfamiliar situation -> participant-controlled reveal -> hypothetical behavior -> optional evidence -> challenge -> final identity question.

`simulation-core.js` defines the strict schema, the fixed Stage 6 situation (`overlooked-helper`, requested by id and always eligible), the older controlled scenario pool (kept for earlier prototypes and tests), evidence filtering, validation and explicit mock behavior. Field mapping for the scene: `predicted_thought` first thought or feeling, `predicted_dialogue` words said in public, `predicted_decision` what to do afterwards, `predicted_action` one concrete action, `predicted_consequence` the immediate consequence. `server/simulation-service.cjs` contains `SIMULATION_PROMPT` and the Responses API adapter. `POST /api/simulation` returns `{ simulation }`.

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

| Process | Browser timeout | Automatic fallback |
| --- | ---: | --- |
| Camera / microphone | 20 s each | Upload or describe the image; type instead of speaking |
| Transcription | 35 s | Keep the recording; type the words (optional retry) |
| Image reading | 25 s | Continue from what you tell it; nothing about the image is guessed |
| Reply / follow-up | 18 s | Plain "Thank you. I've kept that exactly as you wrote it." |
| Reading the answers together | 35 s | Closing line, no interpretation |
| Model of you | 95 s | Keep the last valid model; one bounded retry when Stage 4 needs it |
| Prediction | 45 s (up to 3 validated attempts on the server) | Ask directly without a prediction; retry allowed only before answering |
| Double's reply | 35 s | One background retry, then continue without a reply |
| ElevenLabs voice | 75 s (Continue with text after 8 s) | Text, optional labelled standard voice |
| D-ID animation | 300 s (Continue with audio after 8 s) | Still portrait + cloned voice |
| Fictional scene | 90 s | Prepared demonstration scene, labelled as not AI |
| Feedback | 15 s | Form kept; try again or download a copy |

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

All unit tests pass (the two long-standing failures were fixed: outdated wording, and a missing OpenAI key now returns 503 with code `missing_api_key`). `tests/conversation.test.cjs` covers the conversation service with a fake Responses client (exact quotes, specific follow-ups, no diagnoses or percentages, traceable first impressions that never read appearance, grounded Stage 2 revisions that are never manufactured from brief answers, a fair tension replacing the bold reading and the open question, an unexplained difference that cannot be softened into a pattern, the review acknowledging explanations, accepting "You misunderstood" and never supplying reasons, input validation); `tests/feedback.test.cjs` covers storage, de-duplication, refused fields, a failing webhook and the token-protected export; `tests/stages.test.cjs` covers the prediction contradiction rule, the fixed Stage 6 situation and source-id cleanup for the new answer ids. Development failure scenarios now also accept `image`, `reply`, `synthesis` and `feedback`, e.g. `/?dev=1&simulate=reply:timeout,synthesis:empty-api-response`.

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
