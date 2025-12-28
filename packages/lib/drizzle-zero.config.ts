import { drizzleZeroConfig } from 'drizzle-zero';
// directly glob import your original Drizzle schema w/ tables/relations
import * as drizzleSchema from './src/schema';

// Define your configuration file for the CLI
export default drizzleZeroConfig(drizzleSchema, {
  // Specify which tables and columns to include in the Zero schema.
  // This allows for the "expand/migrate/contract" pattern recommended in the Zero docs.

  // All tables/columns must be defined, but can be omitted or set to false to exclude them from the Zero schema.
  // Column names match your Drizzle schema definitions
  tables: {
    // this can be set to false
    // e.g. users: false,
    user: {
      id: true,
      name: true,
      // omit columns to exclude them
      email: true,
    },
    account: {
      id: true,
      accountId: true,
      userId: true,
    },
    doc: {
      id: true,
      title: true,
      content: true,
      ownerId: true,
    },
  },

  // Specify the casing style to use for the schema.
  // This is useful for when you want to use a different casing style than the default.
  // This works in the same way as the `casing` option in the Drizzle ORM.
  //
  // @example
  // casing: "snake_case",
});
