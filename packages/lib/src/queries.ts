import { syncedQuery } from '@rocicorp/zero';
import { builder } from './zero-schema';

export const accountsQuery = syncedQuery(
  'accountsByUser',
  (args: unknown[]) => {
    if (args.length >= 1) {
      const arg = args[0];
      if (typeof arg === 'string') {
        return [arg] as const;
      }
    }
    throw new Error('Invalid user id');
  },
  (userId) => {
    return builder.account.where('userId', userId);
  }
);
