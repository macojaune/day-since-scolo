import type { Context } from "@netlify/functions"
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import {scoloData} from "../../src/schema";

const client = createClient({ url: Netlify.env.get('TURSO_URL'), authToken: Netlify.env.get('TURSO_TOKEN') });

const db = drizzle(client);

export default async (req: Request, context: Context) => {
  const result = await db.select().from(scoloData).all()
  return new Response(result?.[0].lastTime)
}
