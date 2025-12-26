import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.ZERO_UPSTREAM_DB!,
});

export const db = drizzle({ client: pool });
