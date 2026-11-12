import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Prose and headlines: a tight grotesk.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// The workhorse face: every number, id, label, stamp and section header.
const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Standing Orders",
  description: "Limit orders for shopping, filled by an agent with PayPal",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${mono.variable} h-full bg-bg antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
