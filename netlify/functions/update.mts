import type { Context } from "@netlify/functions"
import {createClient} from "@libsql/client";
import {drizzle} from "drizzle-orm/libsql";
import {scoloData} from "../../src/schema";
import {eq} from "drizzle-orm";


export default async (req: Request, context: Context) => {
  const client = createClient({ url: Netlify.env.get('TURSO_URL'), authToken: Netlify.env.get('TURSO_TOKEN') });
  const db = drizzle(client);

  await db.update(scoloData).set(eq(scoloData.lastTime, new Date().toISOString()))
  return new Response("Ok")
}
