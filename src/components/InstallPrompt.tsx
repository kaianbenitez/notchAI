"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY = "notch:install-prompt-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (isStandalone() || window.localStorage.getItem(DISMISSED_KEY) === "1") return;
    const timeout = window.setTimeout(() => {
      setDismissed(false);
      if (isIOS()) setShowIOSHint(true);
    }, 0);
    if (isIOS()) return () => window.clearTimeout(timeout);
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDismissed(true);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  const install = async () => {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    setDeferredEvent(null);
    dismiss();
  };

  if (dismissed || (!deferredEvent && !showIOSHint)) return null;

  return (
    <div className="mx-auto flex w-full max-w-6xl items-center gap-3 border-b border-slate-800/80 bg-slate-900/70 px-5 py-2 text-sm text-slate-300 sm:px-6">
      {deferredEvent ? (
        <>
          <span className="flex-1">Install Notch on this device for quicker access.</span>
          <button type="button" onClick={install} className="rounded-md bg-emerald-400 px-3 py-1.5 font-semibold text-slate-950 hover:bg-emerald-300">
            Install
          </button>
        </>
      ) : (
        <span className="flex-1">
          Add Notch to your home screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
        </span>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss install prompt" className="text-slate-500 hover:text-slate-300">
        ✕
      </button>
    </div>
  );
}
