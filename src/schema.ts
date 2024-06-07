import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
export const scoloData = sqliteTable("scolo-data", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: integer("created_at", { mode: "timestamp" }),
  tool: text("tool"),
});

export const bets = sqliteTable("bets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("userId").notNull(),
  spawnId: integer("spawnId").notNull(),
  estimationDate: integer("estimationDate", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

export const credits = sqliteTable("credits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("userId").notNull(),
  oldCredit: integer("oldCredit").notNull(),
  newCredit: integer("newCredit").notNull(),
  transactionType: text("transactionType", { enum: ["bet", "buy", "reset"] }),
  transactionId: integer("transactionId"),
  createdAt: integer("created_at", { mode: "timestamp" }),
});

export const betsRelations = relations(bets, ({ one }) => ({
  spawn: one(scoloData, { fields: [bets.spawnId], references: [scoloData.id] }),
}));
