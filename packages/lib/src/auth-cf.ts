import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from './schema';
import type { DrizzleDB } from './db-cf';

interface AuthEnv {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BETTER_AUTH_URL: string;
}

/**
 * Creates a Better Auth instance for Cloudflare Workers.
 * Must be called per-request with the env bindings and db instance.
 */
export function createAuth(db: DrizzleDB, env: AuthEnv) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [
      'http://localhost:5173',
      'http://localhost:8787',
      'https://localhost:4848',
      'https://localhost:3000',
    ],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
