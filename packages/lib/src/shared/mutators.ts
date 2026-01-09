import { defineMutators, defineMutator } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./zero-schema.gen";
import { LoroDoc } from "loro-crdt";
import { decodeBase64, encodeBase64 } from "./utils";

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
        if (updates.length === 0) {
          return; // Nothing to flush
        }

        const doc = await tx.run(zql.doc.where("id", docId).one());
        if (!doc) {
          throw new Error(`Doc not found: ${docId}`);
        }

        const loroDoc = new LoroDoc();
        try {
          loroDoc.configTextStyle({
            bold: { expand: "none" },
            italic: { expand: "none" },
            underline: { expand: "none" },
          });
          loroDoc.setRecordTimestamp(true);

          // Import existing document content
          try {
            loroDoc.import(decodeBase64(doc.content));
          } catch (importError) {
            console.error(
              `Failed to import existing doc content for ${docId}:`,
              importError
            );
            throw new Error(`Corrupted document content: ${docId}`);
          }

          loroDoc.importBatch(updates.map((update) => decodeBase64(update)));
          const snapshot = loroDoc.export({ mode: "snapshot" });
          await tx.mutate.doc.update({
            id: docId,
            content: encodeBase64(snapshot),
          });
        } finally {
          loroDoc.free();
        }
      }
    ),
  },
});
