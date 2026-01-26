import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono, Sora } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "SnapIt - Screen Capture & Recording Made Beautiful",
  description:
    "Capture screenshots, record videos, and create stunning GIFs with the most elegant screen recording tool for Windows.",
  keywords: [
    "screen capture",
    "screen recording",
    "screenshot",
    "video recording",
    "GIF maker",
    "Windows",
    "desktop app",
  ],
  openGraph: {
    title: "SnapIt - Screen Capture & Recording Made Beautiful",
    description:
      "Capture screenshots, record videos, and create stunning GIFs with the most elegant screen recording tool for Windows.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${instrumentSans.variable} ${jetbrainsMono.variable} ${sora.variable} antialiased`}
      >
        <div className="noise" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
