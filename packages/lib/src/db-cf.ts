import { zeroDrizzle } from '@rocicorp/zero/server/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { schema } from './zero-schema.gen';

interface HyperdriveBinding {
  connectionString: string;
}

/**
 * Creates a Drizzle database instance for Cloudflare Workers using Hyperdrive.
 * Call this per-request with the Hyperdrive binding.
 */
export function createDB(hyperdrive: HyperdriveBinding) {
  return drizzle(hyperdrive.connectionString);
}

export type DrizzleDB = ReturnType<typeof createDB>;

/**
 * Creates a Zero DB provider for Cloudflare Workers.
 * Call this per-request with the db instance.
 */
export function createZeroDBProvider(db: DrizzleDB) {
  return zeroDrizzle(schema, db);
}

export type ZeroDBProvider = ReturnType<typeof createZeroDBProvider>;
