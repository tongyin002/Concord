import { defineQueries, defineQuery } from '@rocicorp/zero';
import { zql } from './zero-schema.gen';

export const queries = defineQueries({
  doc: {
    all: defineQuery(({ ctx: { userID } }) => zql.doc.where('ownerId', userID)),
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
