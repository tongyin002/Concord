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
    origin: ['http://localhost:5173', 'http://localhost:4848'],
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

export class CollaborationDO extends DurableObject<CloudflareBindings> {
  constructor(state: DurableObjectState, env: CloudflareBindings) {
    super(state, env);
  }

  fetch(request: Request): Response | Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const { 0: client, 1: server } = webSocketPair;
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer) {
    this.ctx.getWebSockets().forEach((activeWs) => {
      if (activeWs !== ws) {
        activeWs.send(message);
      }
    });
  }

  webSocketClose?(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): void | Promise<void> {
    ws.close(code, reason);
  }
}
