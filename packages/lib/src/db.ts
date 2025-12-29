import { zeroDrizzle } from '@rocicorp/zero/server/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from './zero-schema.gen';

const pool = new Pool({
  connectionString: process.env.ZERO_UPSTREAM_DB!,
});

export const db = drizzle({ client: pool });

export const zeroDBProvider = zeroDrizzle(schema, db);

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    dbProvider: typeof zeroDBProvider;
  }
}
