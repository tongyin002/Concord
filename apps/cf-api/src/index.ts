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

export default app;

/**
 * Flushes pending CRDT updates to the database.
 * Called directly by the Durable Object alarm handler.
 */
export async function flushUpdatesToDatabase(
  env: CloudflareBindings,
  docId: string,
  updates: string[]
): Promise<void> {
  const db = createDB(env.HYPERDRIVE);
  const zeroDBProvider = createZeroDBProvider(db);

  await zeroDBProvider.transaction(async (tr) => {
    await mutators.doc.flushUpdates.fn({
      tx: tr,
      args: { docId, updates },
      ctx: { userID: 'system' },
    });
  });
}

export class CollaborationDO extends DurableObject<CloudflareBindings> {
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
    if (this.pendingUpdates.length === 0) {
      this.alarmScheduled = false;
      return;
    }

    const updatesToFlush = [...this.pendingUpdates];
    const docId = updatesToFlush[0].docId;

    try {
      // Call mutator directly instead of HTTP - no network hop needed
      await flushUpdatesToDatabase(
        this.env,
        docId,
        updatesToFlush.map((u) => u.data)
      );

      // Only clear buffer after successful flush (fixes data loss bug)
      this.pendingUpdates = this.pendingUpdates.slice(updatesToFlush.length);
      this.alarmScheduled = false;
    } catch (error) {
      console.error('Failed to flush updates:', error);
      // Don't clear buffer on failure - reschedule to retry
      this.alarmScheduled = true;
      await this.ctx.storage.setAlarm(Date.now() + 20000);
    }
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
