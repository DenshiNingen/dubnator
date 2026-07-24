import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = "https://dubnator.denshi.io";
const TITLE =
  "Dubnator — browser dub/reggae FX rack & sound-system channel strip";
const DESCRIPTION =
  "A browser-based dub & reggae sound-system FX rack and channel strip. Spring reverb, tape echo, sirens and steppers — free, open-source, runs in any modern browser and ships as a desktop app.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s — Dubnator",
  },
  description: DESCRIPTION,
  applicationName: "Dubnator",
  keywords: [
    "dub",
    "reggae",
    "sound system",
    "FX rack",
    "channel strip",
    "spring reverb",
    "tape echo",
    "web audio",
    "browser DAW",
    "audio effects",
    "open source",
  ],
  authors: [{ name: "Denshi Ningen" }],
  creator: "Denshi Ningen",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "Dubnator",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    creator: "@dubnator",
  },
  icons: {
    icon: "/favicon.ico",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full bg-bg font-sans text-text flex flex-col">
        {children}
      </body>
    </html>
  );
}
