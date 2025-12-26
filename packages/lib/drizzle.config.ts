import { config } from '@dotenvx/dotenvx';
import { defineConfig } from 'drizzle-kit';

config({ path: '../../.env' });

export default defineConfig({
  out: './drizzle',
  schema: './src/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.ZERO_UPSTREAM_DB as string,
  },
});
