import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IMAX 70mm Tracker",
  description: "Get notified the moment IMAX 70mm showtimes drop at your theatres.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
