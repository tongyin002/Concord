import { auth } from 'lib/auth';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  accountsQuery,
  handleGetQueriesRequest,
  ReadonlyJSONValue,
  withValidation,
} from 'lib/zero';
import { schema } from 'lib/zero-client';

const app = new Hono();

// Build a map of queries with validation by name.
const validated = Object.fromEntries(
  [accountsQuery].map((q) => [q.queryName, withValidation(q)])
);

function getQuery(name: string, args: readonly ReadonlyJSONValue[]) {
  const q = validated[name];
  if (!q) {
    throw new Error(`No such query: ${name}`);
  }
  return {
    // First param is the context for contextful queries.
    // `args` are validated using the `parser` you provided with
    // the query definition.
    query: q(undefined, ...args),
  };
}

app.use(
  '/api/auth/*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:4848'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
    credentials: true,
  })
);

app
  .on(['POST', 'GET'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw);
  })
  .on(['POST'], 'api/zero/get-queries', async (c) => {
    return c.json(await handleGetQueriesRequest(getQuery, schema, c.req.raw));
  });

export default app;
