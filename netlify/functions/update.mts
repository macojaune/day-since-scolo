import type { Config, Context } from "@netlify/functions";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { scoloData } from "../../src/schema";
import * as schema from "../../src/schema";

const client = createClient({
  url: Netlify.env.get("TURSO_URL"),
  authToken: Netlify.env.get("TURSO_TOKEN"),
});

const db = drizzle(client, { schema });

export default async (req: Request, context: Context) => {
  const tool = context.params?.tool ?? "digrain";
  const date = context.params?.date
    ? new Date(context.params.date)
    : new Date();
  await db.insert(scoloData).values({ createdAt: date, tool });
  return new Response(
    "Added : le " + date.toString() + "-> " + date.getTime() + " avec " + tool,
  );
};

export const config: Config = {
  path: ["/update", "/update/:tool", "/update/:tool/:date"],
};
