import { defineMutators, defineMutator } from '@rocicorp/zero';
import { z } from 'zod';

export const mutators = defineMutators({
  doc: {
    create: defineMutator(
      z.object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
      }),
      async ({ tx, args: { id, title, content }, ctx: { userID } }) => {
        await tx.mutate.doc.insert({
          id,
          title,
          content,
          ownerId: userID,
        });
      }
    ),
  },
});
