"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari predates the display-mode media query for installed apps.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Add to home screen.
 *
 * Two different worlds. Chrome on Android and desktop fires
 * `beforeinstallprompt`, which we hold on to and replay when the user asks —
 * that is the supported one-tap install. Safari on iOS has no such event and
 * never will, so there the only honest thing to do is show the three steps and
 * point at the share button.
 */
export function InstallPrompt({ compact = false }: { compact?: boolean }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<"pending" | "installed" | "ios" | "other">("pending");

  useEffect(() => {
    if (isStandalone()) {
      setPlatform("installed");
      return;
    }
    setPlatform(isIos() ? "ios" : "other");

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setPlatform("installed");

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Already installed, or we do not yet know — say nothing rather than offering
  // an install that will not work.
  if (platform === "installed" || platform === "pending") return null;

  if (deferred) {
    return (
      <button
        type="button"
        onClick={async () => {
          await deferred.prompt();
          await deferred.userChoice;
          setDeferred(null);
        }}
        className="w-full rounded-2xl bg-[color:var(--accent)] px-4 py-3 text-center text-sm font-bold text-[color:var(--base)]"
      >
        📲 התקינו את האפליקציה במסך הבית
      </button>
    );
  }

  if (platform === "ios") {
    return (
      <div className="rounded-2xl bg-[color:var(--surface)] p-4 text-sm ring-1 ring-white/10">
        <p className="font-bold">📲 להוסיף למסך הבית באייפון</p>
        <ol className="mt-2 list-decimal space-y-1 pr-5 opacity-75">
          <li>לחצו על כפתור השיתוף בסרגל התחתון של ספארי</li>
          <li>גללו ובחרו &quot;הוספה למסך הבית&quot;</li>
          <li>לחצו &quot;הוספה&quot; — וזהו</li>
        </ol>
      </div>
    );
  }

  // Chromium without the event yet (or a browser that never fires it).
  if (compact) return null;
  return (
    <p className="text-center text-xs opacity-50">
      אפשר להוסיף את האפליקציה למסך הבית דרך תפריט הדפדפן.
    </p>
  );
}
