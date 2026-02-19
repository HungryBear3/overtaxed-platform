import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OverTaxed - Automated Property Tax Appeals",
  description: "Fully automated property tax appeal service for Illinois homeowners",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
