"use client";

/**
 * The accounts and categories screen. Both are the same table (PLAN.md §3), so
 * both pages render this — they differ only in which types can be created and
 * whether nesting is offered.
 */

import { useActionState, useState } from "react";

import type { AccountWithBalance } from "../accounts/repo";
import {
  archiveAccountAction,
  createAccountAction,
  deleteAccountAction,
  renameAccountAction,
  unarchiveAccountAction,
  NO_ERROR,
  type ActionState,
} from "../app/accounts/actions";
import { formatPeso } from "../money";

/** Option values are "role:kind" — see parseType in the action module. */
export interface TypeOption {
  value: string;
  label: string;
}

interface Props {
  title: string;
  blurb: string;
  accounts: AccountWithBalance[];
  typeOptions: TypeOption[];
  /** Categories nest (Food > Groceries); wallets and cards do not. */
  nestable?: boolean;
  emptyMessage: string;
}

const INPUT =
  "rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 " +
  "placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none";

const BUTTON =
  "rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";

export function AccountManager({
  title,
  blurb,
  accounts,
  typeOptions,
  nestable = false,
  emptyMessage,
}: Props) {
  const [showArchived, setShowArchived] = useState(false);
  const visible = accounts.filter((a) => showArchived || a.archivedAt === null);
  const archivedCount = accounts.filter((a) => a.archivedAt !== null).length;

  // Depth drives the indent. Parents that are filtered out are treated as roots
  // by the repo's ordering, so a missing link never hides a row.
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const depthOf = (account: AccountWithBalance): number => {
    let depth = 0;
    let cursor = account.parentId;
    while (cursor && byId.has(cursor) && depth < 8) {
      depth += 1;
      cursor = byId.get(cursor)!.parentId;
    }
    return depth;
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-100">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">{blurb}</p>
      </header>

      <CreateForm
        typeOptions={typeOptions}
        parents={nestable ? accounts.filter((a) => a.archivedAt === null) : []}
        nestable={nestable}
      />

      <div className="mt-10">
        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">
            {emptyMessage}
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {visible.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                depth={depthOf(account)}
                parents={
                  nestable
                    ? accounts.filter(
                        (a) => a.archivedAt === null && a.id !== account.id,
                      )
                    : []
                }
                nestable={nestable}
              />
            ))}
          </ul>
        )}

        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="mt-4 text-sm text-slate-400 underline underline-offset-4 hover:text-slate-200"
          >
            {showArchived
              ? "Hide archived"
              : `Show ${archivedCount} archived`}
          </button>
        )}
      </div>
    </div>
  );
}

function CreateForm({
  typeOptions,
  parents,
  nestable,
}: {
  typeOptions: TypeOption[];
  parents: AccountWithBalance[];
  nestable: boolean;
}) {
  const [state, submit, pending] = useActionState(createAccountAction, NO_ERROR);

  return (
    <form
      action={submit}
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <input
          name="name"
          required
          maxLength={80}
          placeholder="Name"
          className={`${INPUT} min-w-40 flex-1`}
        />
        <select name="type" className={INPUT} defaultValue={typeOptions[0]?.value}>
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {nestable && (
          <select name="parentId" className={INPUT} defaultValue="">
            <option value="">No parent</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                under {parent.name}
              </option>
            ))}
          </select>
        )}

        <button
          type="submit"
          disabled={pending}
          className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>

      {state.error && <ErrorNote message={state.error} />}
    </form>
  );
}

function AccountRow({
  account,
  depth,
  parents,
  nestable,
}: {
  account: AccountWithBalance;
  depth: number;
  parents: AccountWithBalance[];
  nestable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const archived = account.archivedAt !== null;

  return (
    <li className={archived ? "opacity-50" : undefined}>
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-3"
        style={{ paddingLeft: `${16 + depth * 20}px` }}
      >
        {editing ? (
          <EditForm
            account={account}
            parents={parents}
            nestable={nestable}
            onDone={() => setEditing(false)}
          />
        ) : (
          <>
            <span className="flex-1 text-sm text-slate-100">
              {account.name}
              {archived && (
                <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">
                  archived
                </span>
              )}
            </span>

            <span className="tabular-nums text-sm text-slate-300">
              {formatPeso(account.displayBalanceMinor)}
            </span>

            {!archived && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={`${BUTTON} text-slate-400 hover:text-slate-100`}
              >
                Edit
              </button>
            )}

            <RowActions account={account} />
          </>
        )}
      </div>
    </li>
  );
}

function EditForm({
  account,
  parents,
  nestable,
  onDone,
}: {
  account: AccountWithBalance;
  parents: AccountWithBalance[];
  nestable: boolean;
  onDone: () => void;
}) {
  const [state, submit, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await renameAccountAction(previous, form);
      if (!result.error) onDone();
      return result;
    },
    NO_ERROR,
  );

  return (
    <form action={submit} className="flex flex-1 flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={account.id} />
      <input
        name="name"
        required
        maxLength={80}
        defaultValue={account.name}
        className={`${INPUT} min-w-40 flex-1`}
      />

      {nestable && (
        <select
          name="parentId"
          className={INPUT}
          defaultValue={account.parentId ?? ""}
        >
          <option value="">No parent</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              under {parent.name}
            </option>
          ))}
        </select>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}
      >
        Save
      </button>
      <button
        type="button"
        onClick={onDone}
        className={`${BUTTON} text-slate-400 hover:text-slate-100`}
      >
        Cancel
      </button>

      {state.error && <ErrorNote message={state.error} />}
    </form>
  );
}

/**
 * Archive, restore, and delete. Delete asks twice rather than opening a browser
 * confirm dialog, and the repo refuses it outright once anything has been filed
 * against the account.
 */
function RowActions({ account }: { account: AccountWithBalance }) {
  const [confirming, setConfirming] = useState(false);
  const archived = account.archivedAt !== null;

  const [archiveState, archive, archivePending] = useActionState(
    archived ? unarchiveAccountAction : archiveAccountAction,
    NO_ERROR,
  );
  const [deleteState, remove, deletePending] = useActionState(
    deleteAccountAction,
    NO_ERROR,
  );

  return (
    <>
      <form action={archive}>
        <input type="hidden" name="id" value={account.id} />
        <button
          type="submit"
          disabled={archivePending}
          className={`${BUTTON} text-slate-400 hover:text-slate-100`}
        >
          {archived ? "Restore" : "Archive"}
        </button>
      </form>

      {confirming ? (
        <form action={remove} className="flex items-center gap-1">
          <input type="hidden" name="id" value={account.id} />
          <button
            type="submit"
            disabled={deletePending}
            className={`${BUTTON} bg-red-600 text-white hover:bg-red-500`}
          >
            Really delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className={`${BUTTON} text-slate-400 hover:text-slate-100`}
          >
            No
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${BUTTON} text-slate-500 hover:text-red-400`}
        >
          Delete
        </button>
      )}

      {(archiveState.error || deleteState.error) && (
        <ErrorNote message={archiveState.error ?? deleteState.error!} />
      )}
    </>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="w-full text-sm text-red-400"
    >
      {message}
    </p>
  );
}
