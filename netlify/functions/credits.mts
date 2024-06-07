import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { desc, eq } from "drizzle-orm";
import * as schema from "../../src/schema";
import { Config } from "@netlify/functions";

const client = createClient({
  url: Netlify?.env.get("TURSO_URL"),
  authToken: Netlify.env.get("TURSO_TOKEN")!,
});

const db = drizzle(client, { schema });
const { credits } = schema;

export default async (req, context) => {
  const result = await db
    .select({ credit: credits.newCredit })
    .from(credits)
    .where(eq(credits.userId, context.params.id))
    .orderBy(desc(credits.createdAt))
    .limit(1);
  return new Response(JSON.stringify(result));
};

export const config: Config = {
  path: ["/credits/:id"],
};
