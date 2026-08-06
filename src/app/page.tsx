import Link from "next/link";

const NEXT_UP = [
  { href: "/log", label: "Log spending", blurb: "Capture money in and out." },
  { href: "/accounts", label: "Accounts", blurb: "Wallets, banks, cards." },
  { href: "/categories", label: "Categories", blurb: "What you spend on." },
  { href: "/month", label: "Month", blurb: "Review this month's actuals." },
  { href: "/net-worth", label: "Net worth", blurb: "Track manual assets and savings goals." },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">
        Notch keeps track of where your money goes.
      </h1>
      <p className="mt-3 max-w-xl text-slate-400">Start with a quick transaction, then keep your accounts and categories in order.</p>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {NEXT_UP.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-slate-800 bg-slate-900/40 px-5 py-6 transition-colors hover:border-emerald-500"
          >
            <span className="text-lg font-medium">{item.label}</span>
            <span className="mt-1 block text-sm text-slate-400">{item.blurb}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
