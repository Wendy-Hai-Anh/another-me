# another-me

Another Me is a browser-based experience exploring how limited personal data can become an AI representation that appears to know, predict, and speak for its users. Its camera step requests permission only after user action, mirrors the preview and capture, and keeps the confirmed JPEG in memory for the current page session.

## Project structure

```text
another-me/
|-- assets/
|   |-- audio/
|   |-- images/
|   `-- video/
|-- frontend/
|   |-- index.html
|   |-- scripts/app.js
|   `-- styles/main.css
|-- backend/
|   |-- dev-server.cjs
|   |-- scripts/clone-voice.mjs
|   `-- README.md
|-- tests/
|   |-- camera-capture.test.cjs
|   `-- integration/
|       |-- did.integration.mjs
|       |-- elevenlabs.integration.mjs
|       `-- openai.integration.mjs
|-- package.json
`-- README.md
```

## Run locally

Node.js is the only requirement. From this directory:

```powershell
npm start
```

Open `http://127.0.0.1:4173`. Do not open `frontend/index.html` directly with `file://`, because browsers require HTTPS or localhost for camera access.

Run the checks with:

```powershell
npm run check
npm test
```

External-service checks are intentionally separate because they can upload test assets or consume API credits:

```powershell
npm run clone:voice
npm run test:elevenlabs
npm run test:openai
npm run test:did
```

## Camera handoff

After the user chooses **Use This Photo**, the confirmed JPEG `Blob` is available through either interface:

```js
const photoBlob = window.anotherMeCamera.getPhotoBlob();

window.addEventListener("another-me:photo-confirmed", ({ detail }) => {
  const photoBlob = detail.blob;
});
```

The Blob is not included in `localStorage`, uploaded, or permanently saved. The local server has no upload endpoint.

Existing OpenAI, ElevenLabs, and D-ID experiments remain server-side scripts. They read keys from `.env.local` and are not connected to the browser camera flow.
