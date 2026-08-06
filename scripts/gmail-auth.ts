import { createServer } from "node:http";
import { google } from "googleapis";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/oauth2callback";
if (!clientId || !clientSecret) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before running this script.");

const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const url = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: ["https://www.googleapis.com/auth/gmail.readonly"] });
console.log("Open this URL in your browser, approve the read-only Gmail scope, then return here:\n", url);
const redirect = new URL(redirectUri);
const server = createServer(async (request, response) => {
  const callback = new URL(request.url ?? "/", redirectUri);
  if (callback.pathname !== redirect.pathname || !callback.searchParams.get("code")) { response.writeHead(404); response.end("Waiting for the OAuth callback."); return; }
  try {
    const { tokens } = await oauth.getToken(callback.searchParams.get("code")!);
    response.end("Authorized. Return to your terminal.");
    console.log("\nSave this in .env and your Vercel environment:\nGOOGLE_REFRESH_TOKEN=" + tokens.refresh_token);
  } finally { server.close(); }
});
server.listen(Number(redirect.port || 80), redirect.hostname);
