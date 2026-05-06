import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./AppShell";

export const metadata: Metadata = {
  title: "AI 会议纪要视觉报告生成器",
  description: "Meeting AI Kit local web workspace"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
