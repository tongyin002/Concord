# Concord

> ⚠️ **Pre-Alpha Demo** — This is an experimental reference implementation showcasing how modern multiplayer applications like Notion and Google Docs can be built using today's cutting-edge technologies. Not intended for production use.

A real-time collaborative document editor built with [ProseMirror](https://prosemirror.net), [Loro CRDT](https://loro.dev), [Zero sync engine](https://rocicorp.dev/zero), and [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/). Supports concurrent multi-user editing with conflict-free synchronization.

## Architecture

```mermaid
graph TB
    Web["Web Client<br/>(React + ProseMirror + Loro)"]
    API["Cloudflare Worker<br/>(Hono API)"]
    DO["Durable Object<br/>(WebSocket Relay)"]
    DB["PostgreSQL<br/>(Document Storage)"]
    Zero["Zero Sync<br/>(Data Layer)"]

    Web -->|WebSocket| DO
    DO -->|Relay Updates| Web
    DO -->|Batch Flush| API
    API -->|Read/Write| DB
    DB -->|Sync Data| Zero
    Zero -->|queries/mutators| API
    Web -->|Query Docs| Zero
```

## Key Features

- **Real-time Collaboration**: Multiple users editing the same document simultaneously
- **CRDT Sync**: Conflict-free updates using Loro CRDT
- **Authentication**: GitHub OAuth via Better Auth
- **Persistence**: Document updates saved to PostgreSQL
- **WebSocket Relay**: Durable Objects coordinate real-time updates across clients

## Project Structure

```
apps/
├── web/                 # React frontend (Vite)
│   ├── src/
│   │   ├── Editor.tsx           # ProseMirror editor component
│   │   ├── Home.tsx             # Document list & sidebar
│   │   └── loroToPm.ts          # CRDT ↔ ProseMirror conversion
│   └── scripts/
│       └── simulate-editing.ts  # Multiplayer testing script
└── cf-api/              # Cloudflare Worker backend (Hono)
    └── src/
        └── index.ts             # API routes & Durable Object
        
packages/lib/src/
├── zero.ts              # Zero framework setup
├── schema.ts            # Database schema
├── queries.ts           # Zero queries
├── mutators.ts          # Zero mutations
└── auth-cf.ts           # Better Auth config
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- Cloudflare Workers account
- PostgreSQL database
- GitHub OAuth app (for authentication)

### Environment Setup

1. Create `.dev.vars` in `apps/cf-api/`:

```
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
BETTER_AUTH_URL=http://localhost:8787
```

2. Create `.env` in the root with database credentials

3. Update `apps/cf-api/wrangler.jsonc` with your Hyperdrive and Durable Object configs

### Installation & Run

```bash
# Install dependencies
pnpm install

# Start dev servers
pnpm dev

# Open http://localhost:5173 in your browser
```

### Testing Multiplayer Editing

```bash
# First time: authenticate
pnpm -F web simulate:auth

# Then run simulation with 4 concurrent clients
pnpm -F web simulate
```

Configure in `apps/web/scripts/simulate-editing.ts`:
- `numClients`: Number of simulated clients
- `docId`: Specific document to edit (or null for any)
- `minTypingDelay`/`maxTypingDelay`: Typing speed

## Development Notes

### Document Sync Flow

1. User types → ProseMirror transaction
2. Transaction converted to Loro updates
3. Updates sent to Durable Object via WebSocket
4. DO broadcasts to other connected clients
5. Updates batched in memory, flushed to DB every 5 seconds
6. Flushed updates applied to PostgreSQL via Zero mutations

### Durable Object Design

- **In-memory buffering**: Updates held in `pendingUpdates` array to reduce storage writes
- **Periodic flushing**: Alarm fires every 5 seconds to persist to database
- **Client synchronization**: New clients receive all pending updates on connection

## License

MIT
