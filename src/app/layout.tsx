import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Notch", template: "%s · Notch" },
  description: "Where your money goes.",
};

const NAV = [
  { href: "/", label: "Home" },
  { href: "/accounts", label: "Accounts" },
  { href: "/categories", label: "Categories" },
  { href: "/log", label: "Log" },
  { href: "/friends", label: "Friends" },
  { href: "/groups", label: "Groups" },
  { href: "/split", label: "Split" },
  { href: "/month", label: "Month" },
  { href: "/budgets", label: "Budgets" },
  { href: "/bills", label: "Bills" },
  { href: "/import", label: "Import" },
  { href: "/changelog", label: "Changelog" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <nav className="border-b border-slate-800">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-6 px-6 py-4 text-sm">
            <Link href="/" className="mr-2 text-base font-semibold tracking-tight text-slate-100">
              Notch
            </Link>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-slate-400 transition-colors hover:text-slate-100"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
