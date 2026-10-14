#!/usr/bin/env bash
# Builds the LectureForge images locally and ships them to the server.
# Images are built here, not on the server: a Next.js build needs ~2 GB of RAM
# that the shared server cannot spare.
#
#   deploy/deploy.sh                 # build, upload, restart
#   DEPLOY_HOST=user@host DEPLOY_KEY=~/.ssh/key deploy/deploy.sh
#
# One-time server setup (secrets, Caddy site) is described in deploy/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${DEPLOY_HOST:-ubuntu@179.237.125.241}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/eeig-dong.pem}"
DIR="${DEPLOY_DIR:-/opt/lectureforge}"
TAG="$(date +%Y%m%d-%H%M)"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST")

echo "==> Building images ($TAG)"
docker build --platform linux/amd64 -f deploy/Dockerfile --target web -t "lectureforge-web:$TAG" .
docker build --platform linux/amd64 -f deploy/Dockerfile --target worker -t "lectureforge-worker:$TAG" .

echo "==> Uploading images"
docker save "lectureforge-web:$TAG" "lectureforge-worker:$TAG" | gzip -1 | "${SSH[@]}" "sudo docker load"

echo "==> Restarting"
scp -i "$KEY" -o IdentitiesOnly=yes deploy/compose.yml "$HOST:/tmp/lectureforge-compose.yml"
scp -i "$KEY" -o IdentitiesOnly=yes control/server.mjs "$HOST:/tmp/lectureforge-control.mjs"
"${SSH[@]}" "set -e
  sudo install -m 644 /tmp/lectureforge-compose.yml $DIR/compose.yml
  sudo install -D -m 644 /tmp/lectureforge-control.mjs $DIR/control/server.mjs
  sudo docker tag lectureforge-web:$TAG lectureforge-web:latest
  sudo docker tag lectureforge-worker:$TAG lectureforge-worker:latest
  cd $DIR && sudo docker compose --env-file .env.production up -d --remove-orphans
  sudo docker compose --env-file .env.production ps"

echo "==> Deployed $TAG"
