export const CHANGELOG_ENTRIES: { date: string; summary: string }[] = [
  {
    date: "2026-08-05",
    summary: "Brought in your full transaction history from the old budgeting app — 527 entries going back to January, across all 14 accounts and 13 categories, with foreign-currency entries converted correctly.",
  },
  {
    date: "2026-08-04",
    summary: "Fixed the receipt-photo shortcut on the Log page — it had stopped working because the photo-reading service retired the AI model it relied on.",
  },
  {
    date: "2026-08-04",
    summary: "Added the Import page: upload a bank statement PDF and it reads the transactions, matches them against what's already logged, and shows you what's new versus what's already there before adding anything.",
  },
  {
    date: "2026-08-04",
    summary: "The Log page can now take a guess at a receipt photo or a short typed description — payee, amount, date, and category — for you to check before saving.",
  },
  {
    date: "2026-08-04",
    summary: "Added Budgets: set a monthly spending limit per category, with the option to carry unused amounts (or overspending) into the next month. The Month page now shows how you're tracking against each budget.",
  },
  {
    date: "2026-08-03",
    summary: "Added the Month page — see what came in, what went out, and your balance by category for any month, with buttons to move to the next or previous month.",
  },
  {
    date: "2026-08-03",
    summary: "Added manual money logging. Entries you add are saved even if you lose your connection — they finish saving once you're back online.",
  },
  {
    date: "2026-08-03",
    summary: "Added the Accounts and Categories pages, so you can set up where your money lives and what it's spent on.",
  },
];
