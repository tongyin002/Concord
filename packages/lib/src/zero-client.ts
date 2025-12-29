import { ZeroOptions } from '@rocicorp/zero';
import { schema, type Schema } from './zero-schema.gen';
import { ZeroContext } from './queries';
import { mutators } from './mutators';

export { Zero } from '@rocicorp/zero';
export * from '@rocicorp/zero/react';

export const zeroBaseOptions: ZeroOptions<Schema, undefined, ZeroContext> = {
  userID: 'anon',
  server: 'http://localhost:4848',
  schema,
  mutators,
};
