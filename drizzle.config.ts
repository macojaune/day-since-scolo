import * as dotenv from "dotenv"
import type { Config } from "drizzle-kit"

dotenv.config()

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  driver: 'turso',
   dbCredentials: {
      url: process.env.TURSO_URL!,
     authToken: process.env.TURSO_TOKEN!,
   }
} satisfies Config;
