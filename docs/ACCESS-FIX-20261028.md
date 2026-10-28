# Live AI access recovery

Build: `v6-20261028-access`.

The opening previously hid the access-code input until `/api/capabilities`
reported `accessCode: true`. A slow or failed request let participants begin
without seeing it. Input was stored only in sessionStorage; blocked storage
silently discarded the code despite the UI comment claiming a page-memory fallback.

The live opening now always offers the field. Enter verifies authorization
using the capabilities endpoint before starting. The endpoint adds an
`accessGranted` boolean without exposing the code or invoking a provider.
The existing API access-code enforcement is unchanged. Page memory retains
the code even when storage is blocked. Session > Live AI access and an
access-error dialog allow recovery without discarding participant inputs.
Recovery never automatically resends images, recordings or generation requests.

## Focused verification

- JavaScript syntax checks passed.
- `node --test tests/hosting.test.cjs` passed: missing, wrong and valid codes,
  CORS restrictions and the existing request budget.
- `node tests/browser/browser-access.cjs` passed at 1280x800 and 390x844:
  failed initial capability discovery, missing/wrong/valid entry codes,
  blocked sessionStorage, recovery dialog, unchanged supplied text.
- No provider or paid generation calls were made.

## Deployment required

These checks used the local source, not the published GitHub Pages/Render deployment.
Deploy BOTH the server change and the public assets. A new frontend against
the old protected backend will explain that the access-check update is needed,
not incorrectly report successful authorization. New asset URLs carry the build
identifier. Do not reload a participant's current tab without warning that its
in-memory session will be lost; open a new tab to check the new build instead.

Successful authorization is distinct from provider billing and credentials.
This fix does not prove that OpenAI, ElevenLabs or D-ID generation is available.
