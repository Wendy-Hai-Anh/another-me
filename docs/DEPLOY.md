# Publishing Another Me

The site is published with **GitHub Pages**. The live AI (OpenAI, ElevenLabs, D-ID) needs a small Node server holding your keys, which is hosted separately (Render's free tier is set up here). Until that server is connected, the published site runs as a clearly labelled **demonstration**: simulated AI text, typed answers, nothing sent anywhere.

```text
Visitor ──> https://wendy-hai-anh.github.io/another-me/   (GitHub Pages: public/ + shared/)
                 │  calls, with access code
                 ▼
            https://another-me-api.onrender.com            (Render: server/, holds the keys)
                 │
                 ▼
            OpenAI · ElevenLabs · D-ID
```

## 1. Publish the site (GitHub Pages)

1. Push `main` to GitHub.
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` runs on every push to `main`. It copies `public/` and the two files in `shared/` into one folder and publishes it.
4. The site appears at `https://wendy-hai-anh.github.io/another-me/` (Actions tab shows progress).

To preview exactly what gets published: `npm run site` builds the same folder into `_site/` (git-ignored).

## 2. Host the AI server (Render, free tier)

1. Sign in to https://render.com with GitHub. **New → Blueprint**, choose this repository. Render reads `render.yaml`.
2. Enter the secret values when asked:

| Setting | Value |
| --- | --- |
| `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `DID_API_KEY` | your keys (as in `.env.local`) |
| `ACCESS_CODE` | a phrase you give to participants; without it nobody can use your credits |
| `ALLOWED_ORIGINS` | already `https://wendy-hai-anh.github.io` (comma-separate more sites) |

3. When it is live, copy its address (e.g. `https://another-me-api.onrender.com`) and open it in a browser: `/api/capabilities` should show `true` for each key and for `accessCode`.

Optional limits (defaults in brackets): `REQUESTS_PER_10_MIN` per visitor (40), `MEDIA_PER_HOUR` cloned-voice/animation requests per visitor (4), `MEDIA_PER_DAY` across everyone (40).

The free tier sleeps after ~15 minutes idle; the first request then takes up to a minute. For an exhibition, wake it beforehand or use a paid instance.

## 3. Connect the site to the server

Edit one line in `public/js/config.js`:

```js
apiBase: "https://another-me-api.onrender.com"
```

Commit and push. Pages republishes; the site now asks visitors for the access code on its first screen and uses the live AI. Remove the address (back to `""`) to return to demonstration mode.

## Running locally

`npm start`, then http://127.0.0.1:4187/. Locally there is no access code unless you set `ACCESS_CODE` in `.env.local`, and the page talks to its own server.

## Privacy: personal media in git history

Portraits, the voice sample, cloned-voice audio and D-ID videos were committed earlier and pushed to this **public** repository. They are no longer tracked (`archive/media-samples/` is git-ignored and still on your computer), but every old commit still contains them under these paths:

```text
portrait.jpg  portrait-2.jpg  voice-sample.m4a  cloned-voice-test.mp3  did-talk-1.mp4  did-talk-2.mp4  voice-id.txt
assets/images/  assets/audio/  assets/video/
archive/media-samples/
```

Removing them means rewriting history, which changes every commit id. Run this yourself when you are ready, from the project folder in Git Bash, after committing everything else:

```bash
git filter-branch --force --prune-empty --index-filter \
  "git rm -r --cached --ignore-unmatch portrait.jpg portrait-2.jpg voice-sample.m4a cloned-voice-test.mp3 did-talk-1.mp4 did-talk-2.mp4 voice-id.txt assets/images assets/audio assets/video archive/media-samples" \
  -- --all
rm -rf .git/refs/original
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git log --all --name-only --format= | grep -iE "portrait|voice-sample|did-talk|cloned-voice|voice-id"   # should print nothing
git push --force origin main
```

Afterwards:

- Anyone who already cloned or forked the repo keeps the old copies. GitHub may still serve old commits by direct link for a while; to have cached views removed, contact GitHub Support (https://support.github.com, "Remove sensitive data").
- `voice-id.txt` named a cloned voice in your ElevenLabs account. Delete that voice in the ElevenLabs dashboard (Voices) if you no longer use it, and remove any leftover uploads in D-ID.
