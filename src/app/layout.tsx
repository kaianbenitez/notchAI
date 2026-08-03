import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Budget App",
  description: "Personal budgeting",
};

const NAV = [
  { href: "/", label: "Home" },
  { href: "/accounts", label: "Accounts" },
  { href: "/categories", label: "Categories" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <nav className="border-b border-slate-800">
          <div className="mx-auto flex w-full max-w-3xl gap-6 px-6 py-4 text-sm">
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
