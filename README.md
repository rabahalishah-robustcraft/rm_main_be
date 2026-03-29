# AI Audio Summarization Backend

TypeScript/Express backend for the AI-powered interview practice platform (audio sessions, profiles, subscriptions). See [Architecture](docs/ARCHITECTURE.md) and [API Documentation](docs/API_DOCUMENTATION.md) for details.

## Prerequisites

- **Node.js** >= 18
- **PostgreSQL**
- **npm** (or yarn)

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
