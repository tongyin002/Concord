# CF-API - Cloudflare Workers API

A Cloudflare Workers version of the API server with Better Auth and Zero integration.

## Setup

### 1. Configure Hyperdrive

Create a Hyperdrive connection to your PostgreSQL database:

```bash
npx wrangler hyperdrive create my-hyperdrive --connection-string="postgres://user:password@host:5432/database"
```

Copy the returned Hyperdrive ID and update `wrangler.jsonc`:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "your-hyperdrive-id-here"
  }
]
```

### 2. Set Secrets

Set your GitHub OAuth credentials as secrets:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

### 3. Update BETTER_AUTH_URL

In `wrangler.jsonc`, update the `BETTER_AUTH_URL` to your worker's URL:

```jsonc
"vars": {
  "BETTER_AUTH_URL": "https://cf-api.your-subdomain.workers.dev"
}
```

## Local Development

### 1. Set up environment variables

Copy `.dev.vars.example` to `.dev.vars` and fill in your GitHub OAuth credentials:

```bash
cp .dev.vars.example .dev.vars
```

### 2. Configure local database

The `wrangler.jsonc` has a `localConnectionString` configured for Hyperdrive that points to your local Postgres. Update it if your local setup differs:

```jsonc
"localConnectionString": "postgresql://postgres:postgres@localhost:5432/postgres"
```

### 3. Start the dev server

```bash
pnpm dev
```

This will start the worker at `http://localhost:8787`.

## Deploy

```bash
pnpm deploy
```

## API Endpoints

- `POST/GET /api/auth/*` - Better Auth endpoints
- `POST /api/zero/get-queries` - Zero query handler
- `POST /api/zero/push` - Zero mutation handler

