import { type Context } from "@netlify/functions";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { bets, credits } from "../../src/schema";
import * as schema from "../../src/schema";

const client = createClient({
  url: Netlify.env.get("TURSO_URL"),
  authToken: Netlify.env.get("TURSO_TOKEN"),
});
const db = drizzle(client, { schema });

export default async (req: Request, context: Context) => {
  const userId = context.params.userId;
  const date = new Date(context.params.date);
  const spawnId = parseInt(context.params.spawnId);
  const oldCredit = parseInt(context.params.credits);
  try {
    const result = await db
      .insert(bets)
      .values({ estimationDate: date, createdAt: new Date(), userId, spawnId })
      .returning({ id: bets.id });
    await db.insert(credits).values({
      userId,
      oldCredit,
      newCredit: oldCredit - 3,
      transactionType: "bet",
      transactionId: result[0].id,
    });
    return { credits: oldCredit - 3 };
  } catch (e) {
    throw new Error(e);
  }
};
