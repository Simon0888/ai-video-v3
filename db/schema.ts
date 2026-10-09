import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
// Only project text and metadata belong in this database.
export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  stateJson: text('state_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});
