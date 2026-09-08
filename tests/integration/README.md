# Integration checks

These scripts make real requests to OpenAI, ElevenLabs, or D-ID when run manually. Some checks consume API credits, and the D-ID check uploads the repository's test portrait and audio.

They are intentionally excluded from the default `npm test` command. Run only the specific `npm run test:*` command you need, with the appropriate keys in `.env.local`.
