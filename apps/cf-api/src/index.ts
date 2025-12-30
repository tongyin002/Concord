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

export default app;
