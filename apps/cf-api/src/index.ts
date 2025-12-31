import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAuth } from 'lib/auth-cf';
import { createDB, createZeroDBProvider } from 'lib/db-cf';
import {
  handleMutateRequest,
  handleQueryRequest,
  mustGetMutator,
  mustGetQuery,
  mutators,
  queries,
  schema,
  type ZeroContext,
} from 'lib/zero';

type Variables = ZeroContext & {
  db: ReturnType<typeof createDB>;
  auth: ReturnType<typeof createAuth>;
};

const app = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

// CORS middleware
app.use(
  '/api/*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:4848', 'http://localhost:8787'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
    credentials: true,
  })
);

// Initialize DB and Auth per-request
app.use('*', async (c, next) => {
  const db = createDB(c.env.HYPERDRIVE);
  const auth = createAuth(db, c.env);
  c.set('db', db);
  c.set('auth', auth);
  return next();
});

// Auth routes (public)
app.on(['POST', 'GET'], '/api/auth/*', (c) => {
  const auth = c.get('auth');
  return auth.handler(c.req.raw);
});

// Auth middleware for protected routes
app.use('/api/zero/*', async (c, next) => {
  const auth = c.get('auth');
  const session = await auth.api.getSession({ headers: c.req.header() });
  if (!session) {
    console.log('hey', c.req.raw);
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('userID', session.user.id);
  return next();
});

// Zero queries endpoint
app.post('/api/zero/get-queries', async (c) => {
  const result = await handleQueryRequest(
    (name, args) => {
      const query = mustGetQuery(queries, name);
      return query.fn({ args, ctx: { userID: c.get('userID') } });
    },
    schema,
    c.req.raw
  );
  return c.json(result);
});

// Zero mutations endpoint
app.post('/api/zero/push', async (c) => {
  const db = c.get('db');
  const zeroDBProvider = createZeroDBProvider(db);

  const result = await handleMutateRequest(
    zeroDBProvider,
    (transact) =>
      transact((tx, name, args) => {
        const mutator = mustGetMutator(mutators, name);
        return mutator.fn({ tx, args, ctx: { userID: c.get('userID') } });
      }),
    c.req.raw
  );
  return c.json(result);
});

app.get('/ws', async (c) => {
  // grab doc id from query params
  const docId = c.req.query('docId');
  if (!docId) {
    return c.json({ error: 'docId is required' }, 400);
  }
  const id = c.env.COLLABORATION_DO.idFromName(docId);
  const stub = c.env.COLLABORATION_DO.get(id);
  return stub.fetch(c.req.raw);
});

// Internal endpoint for DO to flush updates - no auth required
// This is called by the Durable Object alarm to persist updates to PostgreSQL
app.post('/api/internal/flush-updates', async (c) => {
  console.log('flush-updates-internal gets called');
  const { docId, updates } = await c.req.json<{ docId: string; updates: string[] }>();

  if (!docId || !updates.length) {
    return c.json({ error: 'docId and updates array are required' }, 400);
  }

  const db = c.get('db');
  const zeroDBProvider = createZeroDBProvider(db);

  await zeroDBProvider.transaction(async (tr) => {
    await mutators.doc.flushUpdates.fn({
      tx: tr,
      args: { docId, updates },
      ctx: { userID: 'system' },
    });
  });

  return c.json({ success: true });
});

export default app;

export class CollaborationDO extends DurableObject<CloudflareBindings> {
  // Worker URL for internal API calls
  private readonly workerUrl = 'http://localhost:8787';
  // In-memory buffer for pending updates
  private pendingUpdates: Array<{ type: string; docId: string; data: string }> = [];
  private alarmScheduled = false;

  constructor(state: DurableObjectState, env: CloudflareBindings) {
    super(state, env);
  }

  async fetch(_request: Request) {
    const webSocketPair = new WebSocketPair();
    const { 0: client, 1: server } = webSocketPair;
    this.ctx.acceptWebSocket(server);

    // Send pending updates to the new client
    for (const update of this.pendingUpdates) {
      server.send(JSON.stringify(update));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    // Broadcast to other clients
    this.ctx.getWebSockets().forEach((activeWs) => {
      if (activeWs !== ws) {
        activeWs.send(message);
      }
    });

    // Parse the message
    let parsed: { type: string; docId: string; data: string } | null = null;

    try {
      parsed = JSON.parse(message);
    } catch {
      // Invalid JSON, skip
      return;
    }

    if (parsed?.type === 'update' && parsed.docId && parsed.data) {
      // Store in memory
      this.pendingUpdates.push({
        type: parsed.type,
        docId: parsed.docId,
        data: parsed.data,
      });

      // Schedule alarm if not already scheduled
      if (!this.alarmScheduled) {
        this.alarmScheduled = true;
        await this.ctx.storage.setAlarm(Date.now() + 20000);
      }
    }
  }

  async alarm() {
    console.log('alarm fired, pending updates:', this.pendingUpdates.length);

    if (this.pendingUpdates.length === 0) {
      this.alarmScheduled = false;
      return;
    }

    const updates = [...this.pendingUpdates];
    // Clear in-memory buffer after successful flush
    this.pendingUpdates = [];
    const theDocId = updates[0].docId;

    // Call the internal flush endpoint
    const response = await fetch(`${this.workerUrl}/api/internal/flush-updates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docId: theDocId,
        updates: updates.map((u) => u.data),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to flush updates:', errorText);
      // Reschedule alarm to retry later
      this.alarmScheduled = true;
      await this.ctx.storage.setAlarm(Date.now() + 20000);
      return;
    }

    this.alarmScheduled = false;
  }

  webSocketClose?(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ): void | Promise<void> {
    ws.close(code, reason);
  }
}
