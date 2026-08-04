import type { Metadata } from "next";
import { CHANGELOG_ENTRIES } from "../../changelog/entries";

export const metadata: Metadata = { title: "Changelog" };

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export default function ChangelogPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Changelog</h1>
      <p className="mt-2 text-sm text-slate-400">What’s changed in Notch.</p>
      <div className="mt-8 space-y-4">
        {CHANGELOG_ENTRIES.map((entry, index) => (
          <article key={`${entry.date}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
            <time dateTime={entry.date} className="text-sm font-medium text-slate-400">
              {formatDate(entry.date)}
            </time>
            <p className="mt-2 leading-7 text-slate-200">{entry.summary}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
