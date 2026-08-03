/**
 * The app's connection to Postgres.
 *
 * `postTransaction` issues `begin` and `commit` itself, so it must run against
 * one dedicated connection — handing it a pool would let those statements land
 * on different backends and silently lose the transaction. Everything therefore
 * goes through `withDb`, which checks out a single client for the duration of
 * the callback.
 */

import { Pool, type PoolClient } from "pg";

import type { Sql } from "../ledger/post";

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env and point it at your Supabase database.",
      );
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

/** Adapt a pg client to the same minimal interface the ledger core takes. */
function asSql(client: PoolClient): Sql {
  return {
    async query<T = unknown>(text: string, params?: unknown[]) {
      const result = await client.query(text, params as unknown[]);
      // The caller names the row shape; pg only knows it is a row.
      return { rows: result.rows as unknown as T[] };
    },
  };
}

export async function withDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(asSql(client));
  } finally {
    client.release();
  }
}
