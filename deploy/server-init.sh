#!/usr/bin/env bash
# One-time setup on the server: creates /opt/lectureforge with generated
# secrets (.env.production, s3.json). Reads the Anthropic API key on stdin so it
# never appears in a command line or log. Safe to re-run: existing files are kept.
#   grep '^ANTHROPIC_API_KEY=' .env | cut -d= -f2- | ssh host 'bash -s' < this-script   (see deploy/README.md)
set -euo pipefail
DOMAIN="${DOMAIN:?}"
ALLOWED="${SIGNUP_ALLOWED_EMAILS:-}"
DIR=/opt/lectureforge
sudo mkdir -p "$DIR"
sudo chown "$(id -u):$(id -g)" "$DIR"
cd "$DIR"

if [ -f .env.production ]; then
  echo ".env.production exists; keeping it."
  exit 0
fi

ANTHROPIC_KEY="${ANTHROPIC_KEY:-}"
rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
PG=$(rand 32)
S3_ID=$(rand 20)
S3_SECRET=$(rand 40)

umask 077
cat > s3.json <<EOF
{
  "identities": [
    {
      "name": "lectureforge",
      "credentials": [{ "accessKey": "$S3_ID", "secretKey": "$S3_SECRET" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
EOF
chmod 644 s3.json # read by the storage container's user

cat > .env.production <<EOF
NODE_ENV=production
APP_URL=https://$DOMAIN
AUTH_URL=https://$DOMAIN
AUTH_TRUST_HOST=true
AUTH_SECRET=$(rand 48)
LOG_LEVEL=info
SIGNUP_ALLOWED_EMAILS=$ALLOWED

POSTGRES_PASSWORD=$PG
DATABASE_URL=postgresql://lectureforge:$PG@127.0.0.1:5433/lectureforge
REDIS_URL=redis://127.0.0.1:6380

S3_ENDPOINT=http://127.0.0.1:8333
S3_PUBLIC_ENDPOINT=https://$DOMAIN
S3_REGION=us-east-1
S3_BUCKET=lectureforge
S3_ACCESS_KEY_ID=$S3_ID
S3_SECRET_ACCESS_KEY=$S3_SECRET
S3_FORCE_PATH_STYLE=true

AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
# Claude model (Sonnet 5.5 / Opus 5.5) and effort (medium / high) are chosen on the admin page (/admin).
GENERATION_CONCURRENCY=2

TRANSCRIPTION_PROVIDER=openai-compatible
TRANSCRIPTION_BASE_URL=http://127.0.0.1:8001/v1
TRANSCRIPTION_MODEL=deepdml/faster-whisper-large-v3-turbo-ct2
TRANSCRIPTION_MAX_MB=500
TRANSCRIPTION_CHUNK_SECONDS=300
TRANSCRIPTION_PART_TIMEOUT_SECONDS=3600
TRANSCRIPTION_CONCURRENCY=1

EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_BASE_URL=http://127.0.0.1:11435/v1
EMBEDDING_MODEL=embeddinggemma
EMBEDDING_DIMENSIONS=768

OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_KEEP_ALIVE=-1
TUTOR_MODEL=gemma4:e2b
TUTOR_NUM_CTX=2048
TUTOR_THINK=false
OCR_PROVIDER=hybrid
OCR_VISION_MODEL=gemma4:e2b
OCR_NUM_CTX=2048

INGEST_CONCURRENCY=1
MALWARE_SCANNER=none
ENABLE_YOUTUBE_INGEST=false
EOF
echo "Created $DIR/.env.production and $DIR/s3.json"
