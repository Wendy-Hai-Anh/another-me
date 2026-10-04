# Another Me v6: Entering the Digital Double

A separate integration at `C:\Users\Wendy\another-me\Integration-Prototype-v6`. The current v4 working files supplied the functional base; `D:\files` supplied the read-only v5 visual reference. Previous prototypes, tests and existing v4 edits are preserved.

## Run Locally

From `C:\Users\Wendy\another-me`:

```powershell
node Integration-Prototype-v6/server/index.cjs
```

- Real integration: http://127.0.0.1:4187/
- Mock text journey: http://127.0.0.1:4187/?mode=mock
- Development simulations: http://127.0.0.1:4187/?dev=1
- Existing v4 comparison: http://127.0.0.1:4183/ at its default port, if its existing server is running. Check that server's configured port; v6 does not start or modify it.
- Previous memory flow remains in the earlier prototypes and the copied `POST /api/fiction` contract. The new UI uses `POST /api/simulation`.

Use localhost in Chrome or Edge, not a file URL or static Live Server: API requests require this Node backend. It uses the repository's existing Node dependencies; no packages or root configuration were changed. If port 4187 is occupied, set `INTEGRATION_PORT` in this terminal before starting. Keep the terminal open.

The server reads environment variables, an optional v6 `.env.local`, then the repository-root `.env.local` read-only. No actual credentials were copied into v6. Restart the server after changing configuration. `.env.example` contains names only:

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

Begin opens a fixed-view digital tunnel with the invitation "Venture into the space between you and another you." Wheel/trackpad, touch swipes, arrows and Page Down change depth, not page position. Reverse movement retreats. Enter experience is the sole bypass; the separate Skip animation button has been removed. Only the entrance installs those gesture handlers. Delete Session resets entry; ordinary Back does not replay it.

The six stages remain in order. One canvas controller draws their distinct quiet environments; meaningful interactions trigger temporary changes. The canvas never interprets emotion or appearance. A persistent Reduce motion switch and the operating-system preference produce static compositions and immediate transitions. Hidden tabs pause rendering. Forward travel descends through the geometry and Back ascends, with a title-free foreground fade lasting approximately 900 ms. These passages do not install scrolling handlers or replay the entrance; End and Delete cancel them.

Prompts and their actions are measured together before adding any reading navigation. Headlines are compact, Begin stays on its opening screen, and desktop prediction/reply controls share a two-column composition. Stage 3 and Stage 4 use one context-aware forward button in the footer: Next question, Build my profile, Review next finding, Compare our answers or Next stage. Main reading panels use that same button and Back, not a second pager. Evidence and My Data dialogs retain their own Previous/Next controls. No document or reading-container scrollboxes are used. Native textareas still support ordinary caret navigation for editing long answers. Back, Skip, End, My Data and Delete Session remain reachable.

Stage 1 shows the capture preview or the chosen photo, never both. The square camera dock in middle stages has a persistent on/off switch. A meaningful image is not automatically treated as a portrait. Capturing and confirming a portrait for D-ID is a separate action.

Stage 3 collects the three answers before the profile review. Each question, recording/playback and editable transcript share one frame. Audio without a transcript can be separately sent to OpenAI or answered by typing; it cannot silently advance as analysed text. Contradictions pair the AI claim and the participant's reply on one screen, side by side on desktop and stacked on phones. Explanations are retained even without selecting a verdict. Exceptionally long claims turn within the claim pane while the reply stays in place; no claim text is discarded. Retry profile and Review my answers remain available. Stage 4 preserves the separate comparison/review sequence.

The checkpoint between Stages 4 and 5 separates permission for:
1. An AI proxy response.
2. Sending the selected own-voice recording to ElevenLabs.
3. Sending a separately confirmed portrait and generated cloned audio to D-ID.

There are exactly three checkpoint screens, with no nested pager or sub-dialog: proxy permission; voice permission with sample selection/playback/recording; photo permission with the one live preview or captured portrait and confirmation. New recordings become the selected sample. Device errors appear beside their controls instead of stacking another panel. Nothing generates until requested. Text-only and Skip are always alternatives. Permissions can be revised from Stage 5. Cloned audio survives animation failure; standard speech is never silently substituted.

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
| Current `Integration-Prototype-v4` | Working six-stage state, labels, questions, profile/contradiction review, recording, server adapters, recovery controls and tests | Functional base, copied before editing |
| `D:\files` | v5 palette, digital-space typography and visual direction | New canvas/UI; reference files unchanged |
| v4 copies of webcam and microphone tests | Mirrored getUserMedia capture, MediaRecorder MIME selection, playback and transcription | Stages 1-4 and consent checkpoint |
| v4 copy of identity-logic test | Strict profile/prediction schemas and Responses prompts | Stages 3-4 |
| v4 interaction-test adaptations | Labels, uncertainty, consent, feedback and in-memory data controls | All stages |
| v4 media-service adapters | ElevenLabs temporary cloning and D-ID upload/poll/download/cleanup | Consented Stage 5 |

`script.js` retains the copied state/device/service implementation. `v6.js` owns the unified forward control, task workspaces, reading panels, checkpoint, scene sequence and simulation review. `motion.js` exposes entrance progress, stage presets, directional travel/cancellation, reaction events, pause/resume and dispose through one bounded-resolution animation loop. `proxy-text.js` shares script cleanup between the browser, proxy adapter and speech route. Older copied styling files are retained for development evidence but are not loaded by the v6 page.

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

## Files and Verification

New v6-specific files: `v6.js`, `v6.css`, `motion.js`, `simulation-core.js`, `server/simulation-service.cjs`, simulation/motion/browser/recovery/reference-verification tests, baseline files and this handoff documentation.

Modified v6 copies: `index.html`, `script.js`, `server/index.cjs`, `.env.example`, journey/server tests and README. All remaining copied files are retained. `STORYBOARD.md` is the historical v4 storyboard, not the v6 specification. `tests/artifacts` contains synthetic screenshots, logs and generated reports, including earlier diagnostic overflow screenshots.

Run each Node test in its own process because server tests intentionally clear API-key environment variables:

```powershell
$tests = 'journey','media-service','openai-adapter','resilience','server','simulation','motion','contrast'
foreach ($name in $tests) { node "Integration-Prototype-v6/tests/$name.test.cjs" }
node Integration-Prototype-v6/tests/verify-references.cjs
```

Browser tests require Playwright and installed Edge, plus the v6 server. On this machine:

```powershell
$env:NODE_PATH = 'C:\Users\Wendy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
node Integration-Prototype-v6/tests/browser.test.cjs
node Integration-Prototype-v6/tests/browser-recovery.cjs
node Integration-Prototype-v6/tests/browser-panel-fixes.cjs
node Integration-Prototype-v6/tests/browser-conversation.cjs
```

All browser test API requests are intercepted. Device UI checks use native canvas/audio MediaStreams from `tests/device-fixture.cjs`, not physical hardware. This tests real browser recording/playback and stream cleanup, but does not prove hardware permission/driver behavior. See [TEST-REPORT.md](TEST-REPORT.md) for results and the distinction between mocked integration verification and live-provider testing.

## Known Limits

- Repeated OpenAI output quality, live ElevenLabs/D-ID quality, account permissions and timing still need consented live checks. The 2026-10-03 report records one successful synthetic-text OpenAI check. The 2026-10-04 conversation/UI follow-up used no paid provider calls or participant biometrics.
- Edge's built-in fake camera intermittently failed on repeated startup/off/on during testing, despite successful isolated cycles. The UI keeps retry/upload/text routes and preserves inputs. The dock now reuses its video element and camera restart includes a bounded release/retry path; physical-camera verification is still required. Controlled stream fixtures are used for the repeatable browser UI suite, not presented as proof that the native-device issue is eliminated.
- Novelty and sensitive-content exclusion are conservative English lexical checks plus prompt constraints and source validation, not a comprehensive semantic or multilingual safety classifier. Broad matches can exclude harmless evidence; paraphrased earlier situations may evade the overlap check.
- Local mock simulation is explicitly rule-based demonstration content, not a live identity prediction. Live behavioral fields are model-generated from eligible session evidence.
- The six-situation pool can be exhausted on repeated retries. Sparse information still produces a hypothetical possibility with low confidence, not claimed knowledge.
- Automated tests cover several fixed viewport sizes and a 640x360 layout equivalent to 200% zoom from 1280x720. Physical touch hardware, actual browser zoom UI, screen-reader narration and real-device quality need manual testing.
- The fixed-view design adds more panels on small screens. A five-to-seven-minute completion time is a design aim, not a measured participant-study result.
