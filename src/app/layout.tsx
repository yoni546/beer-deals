import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import type { CSSProperties } from "react";
import "./globals.css";
import { getViewer } from "@/lib/session";
import { themeColor, themeFor } from "@/lib/theme";
import { publicEnv } from "@/lib/env";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";

// Self-hosted at build time by next/font: no request to Google at runtime, no
// layout shift while the Hebrew face loads, and no third party watching who
// opens the app.
const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
  variable: "--font-heebo",
});

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: "מבצעי בירה",
  description: "כל מבצעי הבירה בסופרים, במקום אחד. איזו בירה במבצע, בכמה, ואיפה.",
  applicationName: "מבצעי בירה",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "מבצעי בירה" },
  openGraph: {
    title: "מבצעי בירה 🍺",
    description: "איזו בירה במבצע, בכמה, ואיפה — תוך שניות.",
    type: "website",
    locale: "he_IL",
  },
  formatDetection: { telephone: false },
};

export async function generateViewport(): Promise<Viewport> {
  const { primaryBeer } = await getViewer();
  return {
    width: "device-width",
    initialScale: 1,
    // Zoom stays available. Locking it out is a phone app cliché that breaks
    // the page for anyone who needs larger text.
    maximumScale: 5,
    themeColor: themeColor(primaryBeer),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { primaryBeer } = await getViewer();

  return (
    <html
      lang="he"
      dir="rtl"
      className={heebo.variable}
      style={themeFor(primaryBeer) as CSSProperties}
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
      </head>
      <body className="antialiased">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
