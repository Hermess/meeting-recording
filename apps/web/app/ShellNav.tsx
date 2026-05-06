"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "主页", icon: HomeIcon },
  { href: "/meetings/new", label: "新建会议", icon: MicIcon },
  { href: "/settings", label: "设置", icon: SettingsIcon }
];

export function ShellNav() {
  const pathname = usePathname();

  return (
    <aside className="app-sidebar">
      <Link className="app-brand" href="/dashboard">
        <span className="app-brand-mark">M</span>
        <span>
          <span className="app-brand-kicker">Meeting AI Kit</span>
          <span className="app-brand-title">智能妙记</span>
        </span>
      </Link>

      <nav className="app-nav" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            item.label === "主页"
              ? pathname === "/" || pathname === "/dashboard"
              : item.href !== "/dashboard" && pathname.startsWith(item.href);
          return (
            <Link className={active ? "app-nav-item active" : "app-nav-item"} href={item.href} key={`${item.href}-${item.label}`}>
              <Icon />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="app-quota">
        <div className="flex items-center justify-between">
          <span>剩余/总量</span>
          <a className="font-semibold text-brand" href="/settings">
            配置
          </a>
        </div>
        <div className="mt-3 space-y-2 text-xs text-muted">
          <div className="flex items-center justify-between">
            <span>语音转文字</span>
            <span>本地</span>
          </div>
          <div className="flex items-center justify-between">
            <span>纪要模型</span>
            <span>已配置</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M12 14a4 4 0 0 0 4-4V7a4 4 0 1 0-8 0v3a4 4 0 0 0 4 4Z" stroke="currentColor" strokeWidth="2" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="2" />
      <path d="M19 12a7.3 7.3 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7.8 7.8 0 0 0-1.7-1L14.5 3h-5l-.3 3a7.8 7.8 0 0 0-1.7 1L5 6 3 9.5 5 11a7.3 7.3 0 0 0 0 2l-2 1.5L5 18l2.5-1a7.8 7.8 0 0 0 1.7 1l.3 3h5l.3-3a7.8 7.8 0 0 0 1.7-1l2.5 1 2-3.5-2.1-1.5c.1-.3.1-.7.1-1Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}
