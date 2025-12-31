import { defineMutators, defineMutator } from '@rocicorp/zero';
import { z } from 'zod';
import { zql } from './zero-schema.gen';
import { LoroDoc } from 'loro-crdt';
import { decodeBase64, encodeBase64 } from './sharedUtils';

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
    delete: defineMutator(
      z.object({
        id: z.string(),
      }),
      async ({ tx, args: { id } }) => {
        await tx.mutate.doc.delete({
          id,
        });
      }
    ),
    flushUpdates: defineMutator(
      z.object({
        docId: z.string(),
        updates: z.array(z.string()),
      }),
      async ({ tx, args: { docId, updates } }) => {
        const doc = await tx.run(zql.doc.where('id', docId).limit(1));
        if (!doc.length) {
          throw new Error(`Doc not found: ${docId}`);
        }
        const theDoc = doc[0];
        const loroDoc = new LoroDoc();
        loroDoc.configTextStyle({
          bold: { expand: 'none' },
          italic: { expand: 'none' },
          underline: { expand: 'none' },
        });
        loroDoc.setRecordTimestamp(true);
        loroDoc.import(decodeBase64(theDoc.content));
        loroDoc.importBatch(updates.map((update) => decodeBase64(update)));
        const snapshot = loroDoc.export({ mode: 'snapshot' });
        loroDoc.free();

        await tx.mutate.doc.update({
          id: docId,
          content: encodeBase64(snapshot),
        });
      }
    ),
  },
});
