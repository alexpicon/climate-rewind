import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./prototype.css";
import "./calm.css";
import { APP_TITLE } from "@/lib/brand";

export const metadata: Metadata = {
  title: APP_TITLE,
  description:
    "Type a US address to replay the storm night, heat wave and tornadoes that really happened near it, from National Weather Service records. Anything not real is tagged SAMPLE.",
};

export const viewport: Viewport = { themeColor: "#060A13", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
