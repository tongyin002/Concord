import {
  boolean,
  createBuilder,
  createSchema,
  definePermissions,
  number,
  relationships,
  string,
  table,
} from '@rocicorp/zero';

const user = table('user')
  .columns({
    id: string(),
    name: string(),
    email: string(),
    emailVerified: boolean(),
    image: string().optional(),
    createdAt: number(),
    updatedAt: number(),
  })
  .primaryKey('id');

const account = table('account')
  .columns({
    id: string(),
    accountId: string(),
    providerId: string(),
    userId: string(),
    accessToken: string().optional(),
    refreshToken: string().optional(),
    idToken: string().optional(),
    accessTokenExpiresAt: number().optional(),
    refreshTokenExpiresAt: number().optional(),
    scope: string().optional(),
    password: string().optional(),
    createdAt: number(),
    updatedAt: number(),
  })
  .primaryKey('id');

const accountRelationship = relationships(account, ({ one }) => ({
  user: one({
    destSchema: user,
    sourceField: ['userId'],
    destField: ['id'],
  }),
}));

export const schema = createSchema({
  tables: [user, account],
  relationships: [accountRelationship],
  enableLegacyQueries: false,
  enableLegacyMutators: false,
});

export type Schema = typeof schema;

export const builder = createBuilder(schema);

export const permissions: ReturnType<typeof definePermissions> =
  definePermissions<unknown, Schema>(schema, () => ({}));
