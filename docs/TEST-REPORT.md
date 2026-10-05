# v6 Verification Report

Verified through 2026-10-04 in this Windows workspace. Initial verification and the conversation follow-up used no paid calls. The 2026-10-03 UI-fix verification below includes an opt-in live OpenAI check with synthetic text only; no real participant media was used.

## Conversation Follow-Up (2026-10-04)

- 58 Node tests pass in the eight documented suites. Added coverage checks citation removal with evidence retained, unresolved-reference rejection before speech generation, directional motion, cancellation, reduced motion and a single animation loop.
- 39 browser check groups pass: the existing 28 groups plus 11 conversation groups. All API responses are intercepted and media comes from synthetic fixtures.
- Stage 3 now has one footer forward action, with question, recording and editable answer on the same frame. Tests include the separate transcription-consent state, typed fallback, edited-transcript persistence and Back navigation.
- Contradiction statement, explanation and verdict remain together. Desktop uses two columns. Small screens retain one frame; unusually long statements turn within their own claim pane, keeping every word accessible alongside the unchanged explanation field.
- The focused conversation fixtures fit 1840x830, 1280x720, 920x415, 390x844, 360x640 and 640x360. The two smaller desktop areas approximate 200% zoom layouts, not actual browser-zoom UI testing.
- Stage 4 retains prediction-before-answer and comparison/review ordering, using the same forward control. Main reading pagination no longer has a duplicate Next button.
- Forward transitions descend and Back transitions ascend through the same canvas environment. They attach no entrance input handlers. End cancels an active passage; reduced motion removes it.
- A synthetic cloned-speech request from a response ending in `[question_1, question_3]` contains only the natural first-person words. Visible script cleanup and preserved evidence metadata are asserted. Backend validation also rejects unresolved spoken source narration before contacting ElevenLabs. No live voice similarity or D-ID lip-sync check was performed.
- All 100 reference-file hashes remain unchanged. Git still shows the pre-existing v4 changes and untracked v6 folder; no changes were reverted, staged or committed.

Reproduce with `tests/browser-conversation.cjs` in addition to the README commands. Final focused screenshots are `tests/artifacts/conversation-answer-1840.png`, `conversation-debate-1840.png`, and their `-360.png` variants. Results are in `conversation-results.json`. Earlier overflow screenshots remain diagnostic evidence, not final layouts. The local v6 server was restarted on port 4187; its logs are `server-conversation.log` and `server-conversation-errors.log`.

Implementation is isolated to v6: `v6.js`, `v6.css`, `motion.js`, `index.html`, `server/index.cjs`, `server/openai-adapter.cjs`, and new shared helper `proxy-text.js`. Tests and this documentation were updated only inside v6. The prior `/api/fiction` implementation and all earlier prototypes are preserved.

## UI-Fix Follow-Up (2026-10-03)

- 55 Node tests pass, including two additional source-label/provenance regression tests. The request-specific source-ID enum is also checked not to affect narrative fields or mutate the shared schema.
- All 21 existing browser groups pass. Seven added browser groups check the reported CTA/prompt separation, word spacing, tunnel controls, three-screen consent flow, recording and portrait capture, and inline camera-denial recovery.
- Targeted sizes: 1900x850, 1280x720, 390x844, 360x640, and 640x360. Begin and initial question actions stay with their headings, with no inner pager. Consent has exactly three screens both with and without an existing recording. Desktop predictions and typed replies share one composition. Long generated reading content still uses panels rather than scrolling or clipped text.
- The confirmed portrait can be retained, retaken or have the active camera turned off. The one camera preview moves into photo setup rather than overlapping it. New voice samples become the selected playback/cloning sample.
- Animated word spans now have explicit spaces between them. The tunnel has an explorative invitation and only one Enter experience button; no Skip animation button.
- Stage 6 logs showed `evidence: invalid provenance`. Request/output source field names now match; source IDs are schema-constrained and display labels come from the verified ID/type pair. The validator still rejects invented IDs, incorrect types and malformed source fields. Errors now distinguish these causes without logging participant text.
- Live OpenAI smoke test: HTTP 200 in 8.646 seconds, three eligible evidence references, one preserved contradiction, low confidence and zero validation errors. Two failed diagnostic runs preceded this passing run; all used the same synthetic fixture, never participant data. A shared-schema reference issue found during those diagnostics was fixed and regression-tested. Final metadata is in `tests/artifacts/simulation-live-panel-fix.json`; earlier diagnostic logs remain available.
- Earlier prototype safety: 100/100 reference hashes remain unchanged. Existing v4 Git changes remain untouched; all implementation edits for this follow-up are inside v6.

Changed implementation files: `v6.js`, `v6.css`, `simulation-core.js`, `server/simulation-service.cjs`. Updated tests/docs: `tests/simulation.test.cjs`, README, this report and FILES. New tests: `tests/browser-panel-fixes.cjs` and opt-in `tests/simulation-live-check.cjs`. Generated screenshots/results and server logs remain under `tests/artifacts/`.

Additional reproduction commands, from the repository root with the documented Playwright runtime configured:

```powershell
node Integration-Prototype-v6/tests/browser-panel-fixes.cjs
# Optional live check: uses synthetic text, but may incur OpenAI charges.
node Integration-Prototype-v6/tests/simulation-live-check.cjs --live
```

This is one successful live generation check, not a guarantee of model quality, future availability or service latency. ElevenLabs and D-ID paths were regression-tested with intercepted responses; no live voice-cloning or lip-sync quality check was performed in this follow-up.

## Initial Build Results

- **53 Node tests passed** in eight separate processes: 25 copied journey regressions, 2 media-adapter tests, 3 preserved memory-contract tests, 9 recovery tests, 1 server/security/input test, 8 new simulation tests, 4 motion tests and 1 palette-contrast test.
- **21 browser check groups passed** across `browser.test.cjs` and `browser-recovery.cjs`, using headless Edge, intercepted APIs and controlled synthetic media. See the generated JSON reports in `tests/artifacts/`.
- **100/100 reference file hashes unchanged**, with no missing files. The reference set includes the earlier integration source/test files and the D-drive visual reference, excluding credentials and dependency/generated directories.
- The running v6 server at `http://127.0.0.1:4187/` returns HTTP 200 and the v6 entry point. Invalid simulation input returns HTTP 400 without making a model call.
- `git status --short` still shows the same pre-existing v4 changes recorded in `git-status-before.txt`, plus the new v6 folder. `git diff --stat` only reports those pre-existing tracked v4 changes because v6 is untracked. Nothing was reverted, staged or committed.

| Check | Result and scope |
| --- | --- |
| Complete journey | PASS: all six stages, text-only mock path, final response and ending |
| Opening | PASS: bounded forward/reverse wheel input, keyboard depth, bypass, full-depth completion, no media access and no later wheel-driven stage movement |
| Touch / hidden tab / reduced motion | PASS: synthetic touch events and motion-controller tests; browser reduced-motion switch; no physical touch-device verification |
| Return and reset | PASS: Back does not replay the entrance; Delete Session resets it and clears state/streams |
| Layout | PASS: all six stage fixtures at 1440x900, 1280x720, 390x844, 360x640 and 640x360; no document or reading-panel overflow in those fixtures |
| Long content | PASS: long proxy output, evidence and My Data use readable Previous/Next panels at 640x360 |
| Source distinction | PASS: source labels carry onto continuation panels; supplied portrait and generated media/text are labelled separately; hypothetical warning persists |
| Palette contrast | PASS: enabled text/source-label palette >= 4.5:1 against defined reading surfaces; control borders >= 3:1. This is not a full accessibility certification |
| Camera controls | PASS with controlled canvas MediaStreams: square dock, off/on, input retained, capture/confirm/retake and one preview |
| Microphone | PASS with synthetic AudioContext MediaStream and real MediaRecorder: record, timer/status, stop, confirm, playback and track cleanup |
| Device denial | PASS with simulated permission-denied errors: upload/text/retry controls remain available |
| Transcription | PASS with intercepted responses: failure retains recorded audio; retry populates the Stage 3 answer. No unconsented transcription request |
| Profile review | PASS: all questions precede profile review, contradictions are visible, explanation/correction is preserved |
| Prediction order | PASS: prediction appears before the actual-answer controls; comparison and judgement remain available |
| Permission checkpoint | PASS: all eight proxy/voice/face combinations, no generation from consent alone, missing portrait and missing sample return to actionable setup |
| Proxy media failure | PASS with intercepted providers: ElevenLabs failure retains text; D-ID failure retains cloned audio; no silent standard-speech substitution |
| Proxy media success | PASS for adapter/request/state paths with synthetic payloads. The dummy vendor MP3/MP4 bytes are not a lip-sync, playback-quality or cloning-quality test |
| Stage 6 reveal | PASS: unfamiliar situation appears alone; participant reveals behavior locally without a second generation request |
| Simulation evidence | PASS: strict fields, source IDs/types, saved evidence snapshot, contradictions, corrections, rejection filtering and sensitive-source exclusions |
| Sparse / conflicting input | PASS: low confidence, unknowns and alternatives; no claim of a real memory |
| Stale results | PASS: rejecting an inference makes the existing simulation explicitly non-current; failed retries retain input and last output |
| Recovery states | PASS: idle/loading/success/error/timeout/fallback, rate limit, network/empty output, slow response and complete media failure through synthetic tests |
| Concurrent requests / deletion | PASS: duplicate generation produces one request; late results cannot repopulate a deleted session |
| Secrets / file safety | PASS: environment/server files are not served; example env contains no credentials; runtime deletion touches only session data |

## Simulation Evaluation

The new test suite repeats fictional consistent/sparse/empty/sensitive cases three times using the mock contract, and separately tests contradictory evidence, participant corrections and rejected inferences. It checks scenario eligibility, meaningful behavioral fields, exact source provenance, uncertainty and required hypothetical labelling. Stubbed Responses API tests verify strict JSON formatting, one bounded validation retry, incomplete output and refusals.

These are deterministic contract/flow checks, **not repeated live-model quality evaluations**. No claim is made that real model outputs are consistent or convincingly resemble a participant. The model-facing prompt and strict schema are in `server/simulation-service.cjs` and `simulation-core.js`.

## Issues Found and Addressed

- Simultaneously visible measurement sheets shrank each other and produced excessive pagination. Sheets are now measured one at a time and cannot flex-shrink.
- Dialog controls initially lacked reserved height. Data/evidence pagers now reserve space before measurement.
- A growing typewriter prompt changed layout after measurement. The reveal now reserves the complete text layout and animates word opacity instead.
- Drafts could leak between similar question fields. They are keyed by stage/question/review signature, and deleted with the session.
- Continued result panels could lose their source context. Source captions are carried forward, and Stage 6 has a persistent warning outside the reading panel.
- Camera renders recreated live video elements. The dock now reuses its video element; obsolete capture elements are detached and released. Restart has a bounded release/retry path within the existing camera deadline.
- Historical simulations could display newly edited source text. Each generated simulation now keeps the evidence version used at generation, separately from current supplied data.

## Remaining Limits

**Native device verification is incomplete.** Edge's built-in fake camera intermittently returned `NotFoundError`, `AbortError` or failed to deliver frames on rapid off/on/startup, including after successful isolated restart cycles. Those native-device runs are not counted as passing. The repeatable browser suite uses controlled canvas/audio MediaStreams and tests the UI, real browser recording/playback and cleanup; it does not prove that this driver's failure is eliminated or that physical hardware works. Test the real camera/microphone with explicit participant permission on the intended browser before a study.

**Live provider verification is limited.** The follow-up above verifies one successful synthetic Stage 6 generation. OpenAI transcription and repeated generation quality, ElevenLabs voice similarity, D-ID face suitability/lip-sync, credits, plan permissions and general service latency still require consented live checks. Key presence is not evidence of successful generation. Existing adapters and their synthetic regression tests are preserved.

Scenario novelty and sensitive-content exclusion use conservative English matching plus prompt constraints and structural/provenance validation. This is not a semantic or multilingual guarantee. The finite scenario pool can be exhausted; that condition remains recoverable rather than inventing an unvalidated replacement.

The 640x360 tests approximate the layout area of 200% zoom on a 1280x720 window, but actual browser zoom controls, physical trackpads/touchscreens and screen-reader narration remain manual checks. Completion time has not been measured with participants. Five to seven minutes is a design goal, not a test result.

## Reproduce

Run the commands in README. Test artifacts include `browser-results.json`, `recovery-results.json`, opening/tunnel/double/simulation screenshots, local server logs and retained earlier overflow diagnostics. Diagnostic screenshots from failed intermediate runs are development evidence, not final passing screenshots.

Reference preservation can be rechecked with `node Integration-Prototype-v6/tests/verify-references.cjs`. The runtime Delete Session action never runs this script or any filesystem command.
