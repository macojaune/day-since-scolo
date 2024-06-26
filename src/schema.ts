import { sqliteTable, integer, text} from "drizzle-orm/sqlite-core";

export const scoloData = sqliteTable('scolo-data', {
  id: integer('id').primaryKey({autoIncrement: true}),
  createdAt: integer('created_at',{mode:'timestamp'}),
  tool:text('tool')
});
