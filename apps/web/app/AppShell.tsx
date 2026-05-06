"use client";

import { usePathname } from "next/navigation";
import { AuthStatus } from "./AuthStatus";
import { ShellNav } from "./ShellNav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/login")) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <ShellNav />
      <div className="app-workspace">
        <header className="app-topbar">
          <div />
          <div className="flex items-center gap-3">
            <AuthStatus />
            <a className="topbar-link" href="/meetings/new">
              新建会议
            </a>
          </div>
        </header>
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
