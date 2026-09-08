# Backend

`dev-server.cjs` serves the frontend on `localhost`, which is required for browser camera access. It has no upload routes, database, or photo storage.

The `scripts/` directory contains opt-in command-line experiments such as ElevenLabs voice cloning. These scripts use `.env.local` and existing files under `assets/`; they are not called by the frontend.

Future API routes should keep camera consent, data retention, and upload behavior explicit rather than silently connecting the in-memory camera Blob.
