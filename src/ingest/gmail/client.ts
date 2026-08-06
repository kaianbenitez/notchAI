import { google } from "googleapis";
import type { GmailMessage } from "./parsers";

export const GMAIL_QUERY = "from:(onlinebanking@bpi.com.ph OR alerts@maribank.com.ph OR bpiinstapay@bpi.com.ph)";

function config() {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REFRESH_TOKEN: refreshToken, GOOGLE_REDIRECT_URI: redirectUri } = process.env;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Gmail ingestion needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN");
  return { clientId, clientSecret, refreshToken, redirectUri: redirectUri || "http://localhost:3000/oauth2callback" };
}

function decode(value?: string | null): string { return value ? Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : ""; }
function body(part: { body?: { data?: string | null }; parts?: any[] }): string { return decode(part.body?.data) || (part.parts ?? []).map(body).join("\n"); }

export async function listGmailMessages(afterHistoryId?: string | null): Promise<{ messages: GmailMessage[]; historyId: string | null }> {
  const settings = config();
  const oauth = new google.auth.OAuth2(settings.clientId, settings.clientSecret, settings.redirectUri); oauth.setCredentials({ refresh_token: settings.refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth });
  const ids = new Set<string>();
  if (afterHistoryId) {
    let pageToken: string | undefined;
    do {
      const history = await gmail.users.history.list({ userId: "me", startHistoryId: afterHistoryId, historyTypes: ["messageAdded"], pageToken });
      for (const event of history.data.history ?? []) for (const added of event.messagesAdded ?? []) if (added.message?.id) ids.add(added.message.id);
      pageToken = history.data.nextPageToken ?? undefined;
    } while (pageToken);
  } else {
    const page = await gmail.users.messages.list({ userId: "me", q: GMAIL_QUERY, maxResults: 20 });
    for (const message of page.data.messages ?? []) if (message.id) ids.add(message.id);
  }
  const messages = await Promise.all([...ids].map(async (id) => {
    const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const headers = new Map((full.data.payload?.headers ?? []).map((header) => [header.name?.toLowerCase(), header.value ?? ""]));
    return { id, from: headers.get("from") ?? "", subject: headers.get("subject") ?? "", body: body(full.data.payload ?? {}) };
  }));
  const allowlisted = messages.filter((message) => /onlinebanking@bpi\.com\.ph|alerts@maribank\.com\.ph|bpiinstapay@bpi\.com\.ph/i.test(message.from));
  const profile = await gmail.users.getProfile({ userId: "me" });
  return { messages: allowlisted, historyId: profile.data.historyId ?? null };
}
