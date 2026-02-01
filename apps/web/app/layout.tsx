import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoopLess — Self-Improving Browser Agent",
  description: "A self-improving browser agent that learns from runs with Redis, Weave, and BrowserBase",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
