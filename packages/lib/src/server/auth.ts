import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from '../shared/schema';
import type { DrizzleDB } from './db';

interface AuthEnv {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BETTER_AUTH_URL: string;
  /** Comma-separated list of trusted origins for CORS */
  TRUSTED_ORIGINS?: string;
}

/**
 * Parse trusted origins from environment variable.
 * Expects comma-separated URLs: "http://localhost:5173,http://localhost:8787"
 * Falls back to common development origins if not set.
 */
function getTrustedOrigins(env: AuthEnv): string[] {
  if (env.TRUSTED_ORIGINS) {
    return env.TRUSTED_ORIGINS.split(',').map((o) => o.trim());
  }
  // Default development origins
  return [
    'http://localhost:5173',
    'http://localhost:8787',
    'http://localhost:4848',
    'http://localhost:3000',
  ];
}

/**
 * Creates a Better Auth instance for Cloudflare Workers.
 * Must be called per-request with the env bindings and db instance.
 */
export function createAuth(db: DrizzleDB, env: AuthEnv) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: getTrustedOrigins(env),
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
