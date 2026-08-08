"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const PRIMARY_NAV = [
  { href: "/", label: "Home", shortLabel: "Home" },
  { href: "/log", label: "Log", shortLabel: "Log" },
  { href: "/month", label: "Month", shortLabel: "Month" },
  { href: "/budgets", label: "Budgets", shortLabel: "Budgets" },
];

const SECONDARY_NAV = [
  { href: "/accounts", label: "Accounts" },
  { href: "/categories", label: "Categories" },
  { href: "/friends", label: "Contacts" },
  { href: "/groups", label: "Groups" },
  { href: "/split", label: "Split" },
  { href: "/net-worth", label: "Net worth" },
  { href: "/bills", label: "Bills" },
  { href: "/import", label: "Import" },
  { href: "/review", label: "Review" },
  { href: "/changelog", label: "Changelog" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNavigation() {
  const pathname = usePathname();
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);

  return <>
    <header className="border-b border-slate-800/80 bg-slate-950/85 backdrop-blur md:sticky md:top-0 md:z-20">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-8 px-5 py-3 sm:px-6">
        <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight text-white">Notch</Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
          {PRIMARY_NAV.slice(0, 4).map((item) => <Link key={item.href} href={item.href} className={`rounded-md px-3 py-2 text-sm transition-colors ${isActive(pathname, item.href) ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-white"}`}>
            {item.label}
          </Link>)}
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm text-slate-400 hover:bg-slate-900 hover:text-white">More</summary>
            <div className="absolute right-0 top-10 z-30 grid w-40 gap-1 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
              {SECONDARY_NAV.map((item) => <Link key={item.href} href={item.href} className={`rounded px-3 py-2 text-sm ${isActive(pathname, item.href) ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>{item.label}</Link>)}
            </div>
          </details>
        </nav>
        <Link href="/log" className="ml-auto hidden rounded-md bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300 md:block">Log transaction</Link>
      </div>
    </header>
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-700/90 bg-slate-950/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
        {PRIMARY_NAV.map((item) => <Link key={item.href} href={item.href} className={`rounded-md px-1 py-2 text-center text-xs font-medium transition-colors ${isActive(pathname, item.href) ? "bg-slate-800 text-emerald-300" : "text-slate-400 hover:text-white"}`}>
          {item.shortLabel}
        </Link>)}
        <button type="button" aria-expanded={isMobileMoreOpen} onClick={() => setIsMobileMoreOpen((open) => !open)} className={`rounded-md px-1 py-2 text-center text-xs font-medium transition-colors ${isMobileMoreOpen || SECONDARY_NAV.some((item) => isActive(pathname, item.href)) ? "bg-slate-800 text-emerald-300" : "text-slate-400 hover:text-white"}`}>
          More
        </button>
      </div>
      {isMobileMoreOpen ? <div className="mx-auto mt-2 grid max-w-lg grid-cols-2 gap-1 border-t border-slate-800 pt-2">
        {SECONDARY_NAV.map((item) => <Link key={item.href} href={item.href} onClick={() => setIsMobileMoreOpen(false)} className={`rounded-md px-3 py-2 text-sm transition-colors ${isActive(pathname, item.href) ? "bg-slate-800 text-emerald-300" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
          {item.label}
        </Link>)}
      </div> : null}
    </nav>
  </>;
}
