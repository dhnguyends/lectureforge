# Deploying LectureForge on a VPS

The production setup targets one Ubuntu VPS with Docker that already hosts other
apps (here: the Infomaniak VPS behind `*.dhnguyen68.eu`). Nothing is built on the
server: images are built locally and uploaded.

```
browser ──HTTPS──▶ Caddy (fastimpact project, ports 80/443)
                     ├─ /lectureforge/*  ──▶ 172.18.0.1:8333  SeaweedFS (uploads, media)
                     └─ everything else  ──▶ 172.18.0.1:3100  web (Next.js)
web, worker (host network) ──▶ 127.0.0.1: postgres 5433 · redis 6380 · S3 8333
                               · embed 11435 (embeddinggemma) · stt 8001 (Whisper, CPU)
                               · shared host Ollama 11434 (gemma4:e2b: tutor, image OCR)
```

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | `web` and `worker` targets (the worker adds ffmpeg, Tesseract, poppler, LibreOffice) |
| `compose.yml` | The stack, with memory/CPU limits so it cannot starve the other apps |
| `Caddyfile.lecture` | Site block to append to the shared Caddyfile |
| `server-init.sh` | One-time: creates `/opt/lectureforge` with generated secrets |
| `.env.production.example` | Every production setting, explained |
| `deploy.sh` | Build, upload and restart (run from Git Bash) |

## Sharing the host's Ollama

The server's Ollama keeps **one** model loaded for good (`gemma4:e2b`, 2,048-token
context) for the live interpreter. LectureForge uses the same model with exactly
the same `num_ctx` and `keep_alive` (`TUTOR_NUM_CTX=2048`, `OCR_NUM_CTX=2048`,
`OLLAMA_KEEP_ALIVE=-1`): any difference would make Ollama reload the model and
stall the other app. The tutor fits its passages and history into that window
(`fitTurnToContext`). Embeddings use a separate small Ollama (`embed`).

## First deployment

1. Server config (secrets are generated on the server; the Anthropic key is read from stdin):
   ```bash
   scp -i ~/.ssh/eeig-dong.pem deploy/server-init.sh ubuntu@179.237.125.241:/tmp/
   grep '^ANTHROPIC_API_KEY=' .env | cut -d= -f2- | ssh -i ~/.ssh/eeig-dong.pem ubuntu@179.237.125.241 \
     "DOMAIN=lecture.dhnguyen68.eu SIGNUP_ALLOWED_EMAILS=you@example.com bash -c 'read -r ANTHROPIC_KEY; export ANTHROPIC_KEY; bash /tmp/server-init.sh'"
   ```
2. Models (one time): `curl -X POST localhost:11435/api/pull -d '{"model":"embeddinggemma"}'` and
   `curl -X POST localhost:8001/v1/models/deepdml/faster-whisper-large-v3-turbo-ct2` on the server.
3. `deploy/deploy.sh`
4. Append `Caddyfile.lecture` to `~/fastimpact/deploy/Caddyfile`, validate and reload:
   ```bash
   sudo docker exec fastimpact-caddy-1 caddy validate --config /etc/caddy/Caddyfile
   sudo docker exec fastimpact-caddy-1 caddy reload --config /etc/caddy/Caddyfile
   ```

## Updates

`deploy/deploy.sh` — migrations run automatically (`migrate` service) before web
and worker restart. Previous images stay tagged by date for rollback:
`sudo docker tag lectureforge-web:<old> lectureforge-web:latest` (same for worker), then `docker compose up -d`.

## Operations

```bash
cd /opt/lectureforge
sudo docker compose --env-file .env.production ps
sudo docker compose --env-file .env.production logs -f worker
sudo docker compose --env-file .env.production exec postgres pg_dump -U lectureforge lectureforge > backup.sql
```

## Admin page and shutting the service down

`control/server.mjs` is a tiny dependency-free Node service (the `control`
container, ~40 MB, no CPU when idle) that stays up when everything else is
stopped. Caddy routes `/admin` to it, and shows its "LectureForge is stopped"
page instead of a 502 while the app is down.

- Sign in with `LECTURE_ACCESS_KEY` (separate 8-hour admin session, rate-limited).
- **AI generation**: model (Claude Sonnet 5.5 default, Opus 5.5) and effort
  (medium default, high). Saved to `/settings/settings.json` in the shared
  `settings` volume; the web app and worker re-read it on change, so it applies
  to the next generation without a restart.
- **Web service**: Start / Restart / Shut down. Shut down stops every container
  of the `lectureforge` Compose project (app first, database last), which frees
  all their memory and CPU; it never touches other projects or the host's
  shared Ollama. Start brings them back in dependency order (waits for Postgres).
  The table shows each service's memory and CPU and the server's free memory.

- **Accounts**: there is no public sign-up page. Create each account here
  (name, email, password; "Generate password" helps) and see the list of
  accounts. The control service calls the app's `/api/admin/users`, authorized
  by a token derived from `LECTURE_ACCESS_KEY` (so the app must be running).
- **Profiles & disciplines**: every account has a profile — Business School,
  Engineering or Research (built in), or one the admin creates. A profile lists
  the disciplines its users' study sets can have (the admin adds and removes
  them); Research allows any discipline. The admin picks the profile when
  creating an account, can change it, and can **delete an account**, which
  removes its study sets, generated materials and uploaded files for good.
- After a shutdown, a pop-up shows how to start the service again from a
  terminal (project directory and commands; `CONTROL_HOST_DIR` and
  `CONTROL_SSH_COMMAND` set them for the VPS). "How to restart from a
  terminal" reopens it while the service is stopped.

The control container mounts the Docker socket (root-equivalent on the host);
it only acts on containers labelled `com.docker.compose.project=lectureforge`
and only after the admin password.

Locally: `npm run control` → http://localhost:3200/admin (also `/admin` through
the dev server). With `CONTROL_LOCAL_PROCESSES=web,worker` it also stops and
starts `npm run dev` / `npm run worker` (logs in `.data/logs/`), and with
`CONTROL_OLLAMA_UNLOAD` it unloads the local Ollama models on shutdown to free
RAM/VRAM.
