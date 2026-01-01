# AGENTS.md

## Commands
- **Dev**: `pnpm dev` (runs all apps via Turbo)
- **Build**: `pnpm build`
- **Lint**: `pnpm lint` (uses oxlint with --type-aware)
- **Format**: `pnpm format` (uses oxfmt), `pnpm format:check`
- **Single app**: `pnpm -F web dev`, `pnpm -F cf-api dev`, `pnpm -F lib dev`
- **No test framework configured** — simulation script: `pnpm -F web simulate`

## Architecture
- **Turborepo monorepo** with pnpm workspaces
- **apps/web**: React + Vite frontend with ProseMirror editor + Loro CRDT
- **apps/cf-api**: Cloudflare Worker backend (Hono) with Durable Objects for WebSocket relay
- **packages/lib**: Shared code — Zero sync, Drizzle schema, Better Auth config
- Real-time sync: ProseMirror → Loro CRDT → WebSocket → Durable Object → PostgreSQL

## Code Style
- TypeScript with ES modules (`"type": "module"`)
- Formatting: oxfmt — 2-space indent, single quotes, trailing commas (ES5), semicolons
- Imports: sorted (oxfmt `sort-imports` rule)
- Linting: oxlint with type-aware checks
- Use `workspace:*` for internal package dependencies
