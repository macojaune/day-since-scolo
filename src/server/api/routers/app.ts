import {z} from "zod";

import {createTRPCRouter, protectedProcedure, publicProcedure,} from "~/server/api/trpc";
import {bets, credits, scoloData} from "~/server/db/schema";
import {desc, eq} from "drizzle-orm";
import { sendTweet } from "~/utils/twitter";

export const appRouter = createTRPCRouter({
		credits: protectedProcedure
		  .input(z.object({id: z.string()}))
		  .query(({input}) => {
			  return ctx.db
				.select({credit: credits.newCredit})
				.from(credits)
				.where(eq(credits.userId, input.id))
				.orderBy(desc(credits.createdAt))
				.limit(1);
		  }),
		bet: protectedProcedure
		  .input(z.object({name: z.string().min(1)}))
		  .mutation(async ({ctx, input}) => {
			  const userId = input.userId;
			  const date = new Date(input.date);
			  const spawnId = parseInt(input.spawnId);
			  const oldCredit = parseInt(input.credits);
			  try {
				  const result = await ctx.db
					.insert(bets)
					.values({estimationDate: date, createdAt: new Date(), userId, spawnId})
					.returning({id: bets.id})
				  await ctx.db.insert(credits).values({
					  userId,
					  oldCredit,
					  newCredit: oldCredit - 3,
					  transactionType: "bet",
					  transactionId: result?.[0]?.id,
				  })
				  return {credits: oldCredit - 3}
			  } catch (e) {
				  console.error(e)
			  }
		  }),
		getLatest: publicProcedure.query(async ({ctx}) => {
			return ctx.db.query.scoloData.findMany({
				orderBy: [desc(scoloData.createdAt)],
			});
		}),
		update: protectedProcedure
		  .input(z.object({ tool: z.string().optional(), date: z.date().optional() }))
		  .mutation(async ({ ctx, input }) => {
		    const tool = input?.tool ?? "digrain";
		    const date = input?.date ? new Date(input.date) : new Date();
		    
		    await ctx.db.insert(scoloData).values({ createdAt: date, tool });
		    
		    const tweetMessage = `[Scolo] Nouvelle abomination exterminée. Arme du crime : ${tool}. Parle de moi à ta tatie qui à plein de biens à louer là ! https://scolo.marvinl.com`;
		    const tweetSent = await sendTweet(tweetMessage);

		    return {
		      message: `Added: le ${date.toString()} -> ${date.getTime()} avec ${tool}`,
		      tweetSent
		    };
		  }),
		
	})
