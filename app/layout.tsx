import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const APP_URL = process.env.APP_URL ?? "https://pz.majorluk.pl";
const TITLE = "PZ-CRCON · Knox County Admin Network";
const DESCRIPTION =
  "Project Zomboid server status, live player map, workshop mods, and RCON-powered admin console for pz.majorluk.pl.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: TITLE,
    template: "%s · PZ-CRCON",
  },
  description: DESCRIPTION,
  applicationName: "PZ-CRCON",
  keywords: [
    "Project Zomboid",
    "Knox County",
    "PZ server",
    "RCON",
    "survival",
    "admin panel",
  ],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: APP_URL,
    siteName: "PZ-CRCON",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("font-sans dark", geist.variable)}>
      <body className="bg-pz-bg text-pz-text">
        {children}
        <Toaster richColors theme="dark" />
      </body>
    </html>
  );
}
