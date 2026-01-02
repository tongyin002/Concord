import { defineQueries, defineQuery } from '@rocicorp/zero';
import { zql } from './zero-schema.gen';
import z from 'zod';

export const queries = defineQueries({
  doc: {
    all: defineQuery(() => zql.doc.limit(20)),
    byId: defineQuery(z.object({ id: z.string() }), ({ args: { id } }) =>
      zql.doc.where('id', id).limit(1)
    ),
    mine: defineQuery(({ ctx: { userID } }) => zql.doc.where('ownerId', userID).limit(1)),
  },
  user: {
    me: defineQuery(({ ctx: { userID } }) => zql.user.where('id', userID).limit(1)),
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
