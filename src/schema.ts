import { text, sqliteTable } from "drizzle-orm/sqlite-core";

export const scoloData = sqliteTable('scolo-data', {
  label: text('label').primaryKey(),
  lastTime: text('last_time'),
});
