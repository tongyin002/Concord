import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { db } from 'db/drizzle';

export const auth = betterAuth({
  trustedOrigins: ['http://localhost:5173', 'http://localhost:3000'],
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  cookieCache: {
    enabled: true,
    maxAge: 5 * 60, // Cache duration in seconds
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
  plugins: [jwt()],
});
