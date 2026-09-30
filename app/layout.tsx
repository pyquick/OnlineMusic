import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sonora Studio",
  description: "A focused workspace for making your next great track.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
