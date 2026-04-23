FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable

ARG DIRECT_URL=postgresql://postgres:postgres@localhost:5432/gfi_rwanda_api?schema=public
ENV DIRECT_URL=$DIRECT_URL

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts prisma.config.d.ts ./
COPY prisma ./prisma
COPY src ./src
COPY test ./test
COPY docker ./docker
COPY certificates ./certificates

RUN pnpm exec prisma generate
RUN pnpm build

EXPOSE 4000

CMD ["sh", "/app/docker/start.sh"]
