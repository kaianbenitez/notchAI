import { withDb } from "../../../../db/client";
import { sendTelegramMessage } from "../../../../notifications/telegram";
import { reconcileDueRules, runDailyReminders } from "../../../../reminders/cron";

function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const today = manilaToday();
  const sent = await withDb(async (sql) => {
    await reconcileDueRules(sql, today);
    return runDailyReminders(sql, today, sendTelegramMessage);
  });
  return Response.json({ sent });
}
