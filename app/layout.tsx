import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Telegram Task Assistant",
  description: "Smart Telegram-based task manager with voice support"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
