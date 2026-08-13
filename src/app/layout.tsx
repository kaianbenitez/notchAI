import type { Metadata } from "next";
import { AppNavigation } from "../components/AppNavigation";
import { InstallPrompt } from "../components/InstallPrompt";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Notch", template: "%s · Notch" },
  description: "Where your money goes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <AppNavigation />
        <InstallPrompt />
        {children}
      </body>
    </html>
  );
}
