/**
 * Who is using the app.
 *
 * Placeholder. This app has exactly one user, and Supabase Auth is M0 work that
 * is not wired up yet — but every table already carries `user_id`, so the value
 * has to come from somewhere. Reading it from the environment keeps that column
 * honest today and gives auth a single call site to replace tomorrow.
 */

/** A fixed UUID so a local database keeps working across restarts. */
const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001";

export function currentUserId(): string {
  return process.env.BUDGET_USER_ID ?? LOCAL_USER_ID;
}
