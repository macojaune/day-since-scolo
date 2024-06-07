import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../../src/schema";
import { desc } from "drizzle-orm";

const client = createClient({
  url: Netlify?.env.get("TURSO_URL"),
  authToken: Netlify.env.get("TURSO_TOKEN")!,
});

const db = drizzle(client, { schema });

export default async () => {
  const result = await db.query.scoloData.findMany({
    orderBy: [desc(schema.scoloData.createdAt)],
  });
  return new Response(JSON.stringify(result));
};
