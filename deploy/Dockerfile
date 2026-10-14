# Production images for LectureForge. Two targets share the build:
#   web    — the Next.js server (standalone output)
#   worker — the background worker, with ffmpeg, Tesseract, poppler and LibreOffice
# Build from the repository root:
#   docker build -f deploy/Dockerfile --target web -t lectureforge-web .
#   docker build -f deploy/Dockerfile --target worker -t lectureforge-worker .

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# Placeholders only: configuration is read at runtime, never baked into the image.
RUN npx prisma generate && \
    DATABASE_URL=postgresql://build:build@localhost:5432/build S3_BUCKET=build S3_ACCESS_KEY_ID=build S3_SECRET_ACCESS_KEY=build \
    npx next build

# ---- web -------------------------------------------------------------------
FROM base AS web
ENV NODE_ENV=production
RUN useradd --system --uid 1001 --home /app lectureforge
COPY --from=build --chown=lectureforge /app/.next/standalone ./
COPY --from=build --chown=lectureforge /app/.next/static ./.next/static
COPY --from=build --chown=lectureforge /app/public ./public
USER lectureforge
CMD ["node", "server.js"]

# ---- worker ----------------------------------------------------------------
FROM base AS worker
ENV NODE_ENV=production
# Media, OCR and document conversion tools. LibreOffice converts Word and
# PowerPoint files to PDF; the fonts keep converted layouts close to the original.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg poppler-utils \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-fra tesseract-ocr-deu tesseract-ocr-spa \
      libreoffice-writer-nogui libreoffice-impress-nogui \
      fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 1001 --home /app lectureforge && mkdir -p /work && chown lectureforge /work
COPY --from=build --chown=lectureforge /app/node_modules ./node_modules
COPY --from=build --chown=lectureforge /app/package.json /app/tsconfig.json /app/prisma.config.ts ./
COPY --from=build --chown=lectureforge /app/prisma ./prisma
COPY --from=build --chown=lectureforge /app/scripts ./scripts
COPY --from=build --chown=lectureforge /app/src ./src
USER lectureforge
ENV WORKER_TMP_DIR=/work SOFFICE_PATH=soffice HOME=/work
CMD ["npx", "tsx", "src/worker/index.ts"]
