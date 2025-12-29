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
  docOperation: {
    create: defineMutator(
      z.object({
        id: z.string(),
        docId: z.string(),
        operation: z.string(),
      }),
      async ({ tx, args: { id, docId, operation } }) => {
        await tx.mutate.docOperation.insert({
          docId,
          id,
          operation,
        });
      }
    ),
  },
  awareness: {
    upsert: defineMutator(
      z.object({
        peerId: z.string(),
        docId: z.string(),
        awareness: z.string(),
      }),
      async ({ tx, args: { peerId, docId, awareness } }) => {
        await tx.mutate.awareness.upsert({
          peerId,
          docId,
          awareness,
        });
      }
    ),
  },
});
