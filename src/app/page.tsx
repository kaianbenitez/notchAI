import Link from "next/link";

const NEXT_UP = [
  { href: "/accounts", label: "Accounts", blurb: "Wallets, banks, cards." },
  { href: "/categories", label: "Categories", blurb: "What you spend on." },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
        Budget app
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">
        Set up your accounts.
      </h1>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
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
