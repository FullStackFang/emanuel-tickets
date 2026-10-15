import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Fraunces } from "next/font/google";
import "./globals.css";

// DM Sans (body/UI), Fraunces (display headings), and JetBrains Mono (metadata)
// are the Emanuel design system's faces. next/font self-hosts and preloads them
// (no layout shift, no Google request at runtime), exposing each as a CSS
// variable that tokens.css points --font-* at.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Emanuel Tickets",
  description: "Events and ticketing, minimal and frictionless.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${fraunces.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
