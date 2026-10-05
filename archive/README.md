# Archive

Earlier work, kept for reference. Nothing here is used by the current app. A checksum of every archived prototype and experiment file is in `docs/reference-baseline.json`; run `npm run check:references` from the project root to confirm nothing has changed.

| Folder | Contents |
| --- | --- |
| `prototypes/` | Integration-Prototype (v1), v2, v3 and v4, each with its own server, page and tests |
| `experiments/` | identity-logic-test, interaction-test, microphone-test, webcam-test, and the first provider scripts (test-openai, test-elevenlabs, test-did, clone-voice) |
| `media-samples/` | Test portraits, the voice sample, cloned-voice and ElevenLabs output, D-ID videos and the saved voice id. These are personal recordings: do not publish them. |

When these were moved here (October 2026), only the lines that locate files were changed so they still run: each prototype server and experiment server now finds `.env.local` in the project root, and the provider scripts read and write their media in `media-samples/`. Everything else is as it was; the original versions are in git history.

Run any of them from the project root, for example:

```powershell
node archive/prototypes/Integration-Prototype-v4/server/index.cjs
node archive/experiments/test-openai.mjs
```
