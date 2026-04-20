import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PZ-CRCON",
  description: "Project Zomboid server admin panel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-pz-bg text-pz-text">{children}</body>
    </html>
  );
}
