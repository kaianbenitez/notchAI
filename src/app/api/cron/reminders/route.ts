import { withDb } from "../../../../db/client";
import { sendTelegramMessage } from "../../../../notifications/telegram";
import { runDailyReminders } from "../../../../reminders/cron";

function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const sent = await withDb((sql) => runDailyReminders(sql, manilaToday(), sendTelegramMessage));
  return Response.json({ sent });
}
