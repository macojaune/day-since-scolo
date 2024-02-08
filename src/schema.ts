import { text, sqliteTable } from "drizzle-orm/sqlite-core";

export const scoloData = sqliteTable('scolo-data', {
  lastTime: text('last_time'),
});
