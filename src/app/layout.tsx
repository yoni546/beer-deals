import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Rubik } from "next/font/google";
import "./globals.css";
import { getViewer } from "@/lib/session";
import { publicEnv } from "@/lib/env";
import { chromeColors, getThemeForBeer, themeStyleSheet } from "@/design/themes";
import { BottleBackdrop } from "@/components/ui/Bottle";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import { EnvironmentBadge } from "@/components/EnvironmentBadge";
import { NavigationProgress } from "@/components/ui/NavigationProgress";
import { TabBar } from "@/components/ui/TabBar";

// Self-hosted at build time by next/font: no request to Google at runtime, no layout
// shift while the faces load, and no third party watching who opens the app.
// Rubik carries all Hebrew and Latin text; Barlow Condensed is only for figures.
const rubik = Rubik({ subsets: ["hebrew", "latin"], display: "swap", variable: "--font-rubik" });
const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-barlow",
});

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: { default: "מבצעי בירה", template: "%s · מבצעי בירה" },
  description: "כל מבצעי הבירה בסופרים, במקום אחד. איזו בירה במבצע, בכמה, ואיפה.",
  applicationName: "מבצעי בירה",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "מבצעי בירה" },
  icons: { icon: [{ url: "/icons/icon-192.png", type: "image/png" }], apple: "/icons/icon-180.png" },
  openGraph: {
    title: "מבצעי בירה",
    description: "איזו בירה במבצע, בכמה, ואיפה — תוך שניות.",
    type: "website",
    locale: "he_IL",
  },
  formatDetection: { telephone: false },
};

/**
 * The person's app: favourite beer #1 decides it, and nothing else does (PRODUCT.md, "Favourite #1
 * is the app"). No beer ranked yet ⇒ the neutral house look.
 */
async function currentTheme() {
  const viewer = await getViewer();
  return getThemeForBeer(viewer.primaryBeer?.slug);
}

// Static viewport. The browser-chrome colour follows the person's theme, so it is rendered as
// <meta name="theme-color"> tags in the layout below rather than through a dynamic generateViewport().
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom stays available. Locking it out is a phone app cliché that breaks the
  // page for anyone who needs larger text.
  maximumScale: 5,
};

/**
 * Runs before the first paint of every page load. The app animates exactly one navigation — the first
 * arrival on Home from onboarding (globals.css, "arriving from onboarding") — so this tags that one
 * and cancels the browser's default cross-fade for every other. A fixed string: nothing user-supplied.
 */
const REVEAL_SCRIPT = `addEventListener("pagereveal",function(e){var t=e.viewTransition;if(!t)return;var a=window.navigation&&navigation.activation,f=a&&a.from&&a.from.url;if(f&&new URL(f).pathname==="/welcome"&&location.pathname==="/"){t.types.add("from-welcome");document.documentElement.dataset.arrived="welcome"}else t.skipTransition()})`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const preset = await currentTheme();
  const chrome = chromeColors(preset);

  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} ${barlow.variable}`}>
      <head>
        {/* Generated from our own theme data (src/design/themes.ts): fixed hex values,
            no user-supplied text ever reaches this stylesheet. */}
        <style id="theme" dangerouslySetInnerHTML={{ __html: themeStyleSheet(preset) }} />
        <script dangerouslySetInnerHTML={{ __html: REVEAL_SCRIPT }} />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content={chrome.light} />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content={chrome.dark} />
      </head>
      <body className="antialiased" data-theme={preset.beerId}>
        <BottleBackdrop preset={preset} />
        <NavigationProgress />
        {children}
        <TabBar />
        <RegisterServiceWorker />
        <EnvironmentBadge />
      </body>
    </html>
  );
}
