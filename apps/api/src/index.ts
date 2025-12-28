import { auth } from 'lib/auth';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleQueryRequest, mustGetQuery, queries, schema, ZeroContext } from 'lib/zero';

const app = new Hono<{ Variables: ZeroContext }>();

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

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.header() });
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('userID', session.user.id);
  return next();
});

app.on(['POST'], 'api/zero/get-queries', async (c) => {
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

export default app;
