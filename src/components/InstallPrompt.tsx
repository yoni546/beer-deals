"use client";

import { useEffect, useState } from "react";
import { InstallIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";

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
export function InstallPrompt({ compact = false, onPaper = false }: { compact?: boolean; /** Already on a strip of paper (onboarding): no second strip, ink instead of counter text. */ onPaper?: boolean }) {
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
        className="btn w-full"
      >
        <InstallIcon size={20} />
        התקינו את האפליקציה במסך הבית
      </button>
    );
  }

  if (platform === "ios") {
    const steps = (
      <>
        <p className="flex items-center gap-2 font-bold text-ink">
          <InstallIcon size={20} />
          להוסיף למסך הבית באייפון
        </p>
        <ol className="mt-2 list-decimal space-y-1 ps-5 text-ink-2">
          <li>לחצו על כפתור השיתוף בסרגל התחתון של ספארי</li>
          <li>גללו ובחרו &quot;הוספה למסך הבית&quot;</li>
          <li>לחצו &quot;הוספה&quot;, וזהו</li>
        </ol>
      </>
    );
    return onPaper ? <div className="text-sm">{steps}</div> : <Tape className="p-4 text-sm">{steps}</Tape>;
  }

  // Chromium without the event yet (or a browser that never fires it).
  if (compact) return null;
  return (
    <p className={`text-sm ${onPaper ? "text-ink-2" : "text-on-ground-2"}`}>
      אפשר להוסיף את האפליקציה למסך הבית דרך תפריט הדפדפן.
    </p>
  );
}
