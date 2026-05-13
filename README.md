# Recruit Me AI Backend

TypeScript/Express backend for the AI-powered interview practice platform (audio sessions, profiles, subscriptions). See [Architecture](docs/ARCHITECTURE.md) and [API Documentation](docs/API_DOCUMENTATION.md) for details.

## Prerequisites

- **Node.js** >= 18
- **PostgreSQL**
- **npm** (or yarn)

## Docker

Prerequisites: [Docker](https://docs.docker.com/get-docker/) with Compose v2.

`DATABASE_URL` inside `.env` is overridden in Compose so the API uses the bundled Postgres service. Fill in the other secrets in `.env` (copy from [.env.example](.env.example)); placeholders are enough to boot, but real keys are required for OpenAI, AWS, and related features.

Start Postgres, apply migrations, and run the API:

```bash
test -f .env || cp .env.example .env && docker compose up --build
```

The API listens on [http://localhost:3000](http://localhost:3000) by default. Set `HOST_PORT` to publish a different host port (for example `HOST_PORT=4000 docker compose up --build`). Database files persist in the `postgres_data` volume.

You can override the bundled database with `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` (use a URL-safe password or adjust `DATABASE_URL` when not using Compose). If `.env` sets `REDIS_URL` to `127.0.0.1`, remove it or point it at a reachable Redis host when running in Docker.

### Publishing the API image to Docker Hub

1. Create a repository on [Docker Hub](https://hub.docker.com/) (for example `youruser/rm-main-be`).
2. In `.env`, set the same name Compose uses to tag builds (see [.env.example](.env.example)):

   ```bash
   DOCKER_HUB_IMAGE=youruser/rm-main-be:1.0.0
   ```

3. Log in and build, then push the `api` service image:

   ```bash
   docker login
   docker compose build api
   docker compose push api
   ```

Use a new tag (for example `1.0.1`, `latest`) whenever you ship a release. The default `DOCKER_HUB_IMAGE` in Compose (`rm-main-be:local`) is only for local builds and is not meant to be pushed.

### Running a pre-built image from Docker Hub

Recipients still need this repository (or at least `docker-compose.yml` and `.env`) plus a `.env` with your secrets. They point Compose at your published image and avoid building from source:

```bash
test -f .env || cp .env.example .env
# Set DOCKER_HUB_IMAGE=youruser/rm-main-be:1.0.0 in .env, then:
docker compose pull api
docker compose up -d --no-build
```

`--no-build` ensures Compose uses the pulled image instead of rebuilding from the Dockerfile.

## Installation

```bash
git clone <repository-url>
cd rm_main_be
npm install
npm run db:generate
```

## Environment

1. Copy the example env file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set at least these **required** variables:

   | Variable | Description |
   |----------|-------------|
   | `DATABASE_URL` | PostgreSQL connection URI (e.g. `postgresql://user:pass@localhost:5432/dbname`) |
   | `JWT_SECRET` | Secret for JWT signing (min 32 characters) |
   | `OPENAI_API_KEY` | OpenAI API key (GPT + optional usage) |
   | `WHISPER_API_KEY` | OpenAI API key for Whisper (transcription) |
   | `AWS_ACCESS_KEY_ID` | AWS access key |
   | `AWS_SECRET_ACCESS_KEY` | AWS secret key |
   | `AWS_REGION` | AWS region (e.g. `us-east-1`) |
   | `AWS_S3_BUCKET` | S3 bucket name for resumes and audio |

   Optional but useful: `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `JWT_EXPIRES_IN`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google OAuth), `RESEND_API_KEY` / `EMAIL_FROM_*` (password reset emails). Full set is in [.env.example](.env.example) and validated in [src/utils/config.ts](src/utils/config.ts).

## Database

1. Create a PostgreSQL database and user matching `DATABASE_URL`.

2. Run migrations:

   ```bash
   npm run db:migrate
   ```

   For production, use `npx prisma migrate deploy` instead of `db:migrate`.

3. (Optional) Seed industries and job titles:

   ```bash
   npm run db:seed
   ```

## Running

- **Development** (with auto-reload):

  ```bash
  npm run dev
  ```

- **Production** (build then start):

  ```bash
  npm run build
  npm start
  ```

Default port is 3000 (or the value of `PORT`). Health check: `GET http://localhost:3000/api/health`.

## Testing

```bash
npm test
```

Coverage:

```bash
npm run test:coverage
```

Tests can use a separate env file (e.g. `.env.test`) for a dedicated test database and keys.

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `build` | `npm run build` | Compile TypeScript to `dist/` |
| `start` | `npm start` | Run compiled app (production) |
| `dev` | `npm run dev` | Dev server with nodemon + ts-node |
| `test` | `npm test` | Run Jest tests |
| `test:watch` | `npm run test:watch` | Run tests in watch mode |
| `test:coverage` | `npm run test:coverage` | Run tests with coverage |
| `db:migrate` | `npm run db:migrate` | Run Prisma migrations (dev) |
| `db:generate` | `npm run db:generate` | Generate Prisma client |
| `db:seed` | `npm run db:seed` | Run database seed |

## Documentation

- [API Documentation](docs/API_DOCUMENTATION.md) — Endpoints, request/response, errors, rate limits.
- [Architecture](docs/ARCHITECTURE.md) — High-level structure, layers, and data flow.
