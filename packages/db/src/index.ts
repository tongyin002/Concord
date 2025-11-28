import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export const db = drizzle(process.env.ZERO_UPSTREAM_DB as string, { schema });
