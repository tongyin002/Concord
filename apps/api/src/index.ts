import { auth } from 'lib/auth';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

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
    return c.json({});
  });

export default app;
