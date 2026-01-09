# CF-API

Cloudflare Workers API with Better Auth, Zero sync, and Durable Objects for WebSocket relay.

## Local Development

```bash
cp .dev.vars.example .dev.vars  # Add GitHub OAuth credentials
pnpm dev                         # http://localhost:8787
```

Update `wrangler.jsonc` if your local Postgres differs from `postgresql://postgres:postgres@localhost:5432/postgres`.

## Production Setup

```bash
# Create Hyperdrive connection
npx wrangler hyperdrive create my-hyperdrive --connection-string="postgres://..."
# Update wrangler.jsonc with the returned Hyperdrive ID

# Set secrets
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET

# Deploy
pnpm deploy
```

## Endpoints

| Route                   | Description                |
| ----------------------- | -------------------------- |
| `/api/auth/*`           | Better Auth (GitHub OAuth) |
| `/api/zero/get-queries` | Zero queries               |
| `/api/zero/push`        | Zero mutations             |
| `/ws?docId=...`         | WebSocket (Durable Object) |
