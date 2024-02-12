import type { Context } from "@netlify/functions"
import {createClient} from "@libsql/client";
import {drizzle} from "drizzle-orm/libsql";
import {scoloData} from "../../src/schema";
import {eq} from "drizzle-orm";

const client = createClient({ url: Netlify.env.get('TURSO_URL'), authToken: Netlify.env.get('TURSO_TOKEN') });
const db = drizzle(client);

export default async (req: Request, context: Context) => {
  await db.update(scoloData).set({lastTime:  new Date().toISOString()}).where(eq(scoloData.label, "latest"))
  return new Response("Ok")
}
