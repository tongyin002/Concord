import { ZeroOptions } from '@rocicorp/zero';
import { schema, type Schema } from '../shared/zero-schema.gen';
import { ZeroContext } from '../shared/queries';
import { mutators } from '../shared/mutators';

/**
 * Creates Zero options with the specified server URL.
 * @param serverUrl - The Zero sync server URL (e.g., http://localhost:4848)
 */
export function createZeroOptions(serverUrl: string): ZeroOptions<Schema, undefined, ZeroContext> {
  return {
    userID: 'anon',
    server: serverUrl,
    schema,
    mutators,
  };
}

/**
 * Default Zero options for development.
 * In production, use createZeroOptions() with your actual server URL.
 */
export const zeroBaseOptions: ZeroOptions<Schema, undefined, ZeroContext> = createZeroOptions('http://localhost:4848');
