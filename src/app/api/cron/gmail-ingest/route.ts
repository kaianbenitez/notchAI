import { currentUserId } from "../../../../auth";
import { withDb } from "../../../../db/client";
import { runGmailIngest } from "../../../../ingest/gmail/cron";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  return Response.json(await withDb((sql) => runGmailIngest(sql, currentUserId())));
}
