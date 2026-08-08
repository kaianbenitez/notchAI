import Link from "next/link";

const TOOLS = [
  { href: "/month", label: "Monthly review", blurb: "See spending, income, and budget progress." },
  { href: "/accounts", label: "Accounts", blurb: "Set up the wallet, bank, or card you use." },
  { href: "/categories", label: "Categories", blurb: "Keep spending organised your way." },
  { href: "/import", label: "Import statement", blurb: "Bring in history when you need it." },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-6 sm:py-16">
      <section className="rounded-2xl border border-emerald-400/20 bg-slate-900/65 p-6 shadow-2xl shadow-emerald-950/20 sm:p-9">
        <p className="text-sm font-medium text-emerald-300">Your money, in focus</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">A quick log now makes the rest of your month clearer.</h1>
        <p className="mt-3 max-w-xl text-slate-400">Capture a payment in a few seconds. Notch keeps the ledger, budgets, and monthly review in sync.</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/log" className="rounded-md bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300">Log a transaction</Link>
          <Link href="/month" className="rounded-md border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white">Review this month</Link>
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4"><h2 className="text-lg font-semibold text-white">Keep things moving</h2><Link href="/log" className="text-sm text-emerald-300 hover:text-emerald-200">Quick log →</Link></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {TOOLS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-5 transition-colors hover:border-emerald-400/70 hover:bg-slate-900"
          >
            <span className="font-medium text-slate-100">{item.label}</span>
            <span className="mt-1 block text-sm text-slate-400">{item.blurb}</span>
          </Link>
        ))}
        </div>
      </section>
    </main>
  );
}
