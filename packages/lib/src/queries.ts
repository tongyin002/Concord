import { defineQueries, defineQuery } from '@rocicorp/zero';
import { zql } from './zero-schema.gen';
import z from 'zod';

export const queries = defineQueries({
  doc: {
    all: defineQuery(() => zql.doc.limit(20)),
    mine: defineQuery(({ ctx: { userID } }) => zql.doc.where('ownerId', userID).limit(1)),
  },
  docOperation: {
    forDoc: defineQuery(
      z.object({
        docId: z.string(),
      }),
      ({ args: { docId } }) => zql.docOperation.where('docId', docId).orderBy('createdAt', 'asc')
    ),
  },
  user: {
    me: defineQuery(({ ctx: { userID } }) => zql.user.where('id', userID).limit(1)),
  },
  awareness: {
    forDoc: defineQuery(
      z.object({
        docId: z.string(),
      }),
      ({ args: { docId } }) => zql.awareness.where('docId', docId).orderBy('updatedAt', 'desc')
    ),
  },
});

export type ZeroContext = {
  userID: string;
};

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    context: ZeroContext;
  }
}
