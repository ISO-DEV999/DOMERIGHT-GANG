import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DOMERIGHT GANG | Membership",
  description: "Sign up and log in for the DOMERIGHT GANG FiveM community.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}