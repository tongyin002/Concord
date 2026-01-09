import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createAuth,
  createDB,
  createZeroDBProvider,
  handleMutateRequest,
  handleQueryRequest,
  mustGetMutator,
  mustGetQuery,
} from 'lib/server';
import { mutators, queries, schema, zql, type ZeroContext } from 'lib/shared';

// Re-export Durable Object for wrangler
export { CollaborationDO } from './CollaborationDO';

type Variables = ZeroContext & {
  db: ReturnType<typeof createDB>;
  auth: ReturnType<typeof createAuth>;
};

const app = new Hono<{ Bindings: ExtendedBindings; Variables: Variables }>();

/** Extended bindings with optional CORS configuration */
interface ExtendedBindings extends CloudflareBindings {
  /** Comma-separated list of allowed CORS origins */
  CORS_ORIGINS?: string;
}

/**
 * Parse CORS origins from environment variable.
 * Expects comma-separated URLs: "http://localhost:5173,http://localhost:8787"
 * Falls back to common development origins if not set.
 */
function getCorsOrigins(env: ExtendedBindings): string[] {
  const originsEnv = env.CORS_ORIGINS;
  if (originsEnv) {
    return originsEnv.split(',').map((o: string) => o.trim());
  }
  // Default development origins
  return ['http://localhost:5173', 'http://localhost:4848', 'http://localhost:8787'];
}

// CORS middleware
app.use('/api/*', async (c, next) => {
  const origins = getCorsOrigins(c.env);
  const corsMiddleware = cors({
    origin: origins,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
    credentials: true,
  });
  return corsMiddleware(c, next);
});

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
  // Authenticate the WebSocket connection
  const auth = c.get('auth');
  const session = await auth.api.getSession({ headers: c.req.header() });
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Grab doc id from query params
  const docId = c.req.query('docId');
  if (!docId) {
    return c.json({ error: 'docId is required' }, 400);
  }

  // Verify document exists
  const db = c.get('db');
  const zeroDBProvider = createZeroDBProvider(db);
  const document = await zeroDBProvider.run(zql.doc.where('id', docId).one());

  if (!document) {
    return c.json({ error: 'Document not found' }, 404);
  }

  const id = c.env.COLLABORATION_DO.idFromName(docId);
  const stub = c.env.COLLABORATION_DO.get(id);

  // Forward the request with user context in a custom header
  const modifiedRequest = new Request(c.req.raw, {
    headers: new Headers([...c.req.raw.headers, ['X-User-ID', session.user.id]]),
  });

  return stub.fetch(modifiedRequest);
});

export default app;
