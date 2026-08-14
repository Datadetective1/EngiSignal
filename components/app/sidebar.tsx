'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';
import {
  IconAsk,
  IconBrief,
  IconCost,
  IconData,
  IconDecisions,
  IconForecast,
  IconIntelligence,
  IconPortfolio,
  IconReclaim,
  IconRenewal,
  IconScenario,
  IconSettings,
  IconUsers,
} from './icons';

type NavItem = {
  href: string;
  label: string;
  icon: (props: { className?: string; size?: number }) => React.ReactElement;
  badge?: number;
};

export interface SidebarProps {
  organizationName: string;
  asOf: string;
  signalCount: number;
  renewalCount: number;
  decisionCount: number;
  userName: string;
  userEmail: string;
}

export function Sidebar({
  organizationName,
  asOf,
  signalCount,
  renewalCount,
  decisionCount,
  userName,
  userEmail,
}: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const primary: NavItem[] = [
    { href: '/app', label: 'Intelligence', icon: IconIntelligence, badge: signalCount },
    { href: '/app/portfolio', label: 'Portfolio', icon: IconPortfolio },
    { href: '/app/renewals', label: 'Renewals', icon: IconRenewal, badge: renewalCount },
    { href: '/app/users', label: 'Users', icon: IconUsers },
    { href: '/app/forecast', label: 'Forecast', icon: IconForecast },
    { href: '/app/cost', label: 'Cost', icon: IconCost },
    { href: '/app/decisions', label: 'Decisions', icon: IconDecisions, badge: decisionCount },
    { href: '/app/data', label: 'Data', icon: IconData },
    { href: '/app/ask', label: 'Ask EngiSignal', icon: IconAsk },
  ];

  const tools: NavItem[] = [
    { href: '/app/scenario', label: 'Scenario Lab', icon: IconScenario },
    { href: '/app/reclaim', label: 'Reclaim', icon: IconReclaim },
    { href: '/app/brief', label: 'Executive Brief', icon: IconBrief },
  ];

  const isActive = (href: string) => (href === '/app' ? pathname === '/app' : pathname.startsWith(href));

  const renderItem = (item: NavItem) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          onClick={() => setOpen(false)}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors',
            active ? 'bg-accent-soft font-medium text-accent' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          <Icon className={cn('shrink-0', active ? 'text-accent' : 'text-fg-subtle group-hover:text-fg-muted')} />
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge !== undefined && item.badge > 0 && (
            <span
              className={cn(
                'tnum rounded-full px-1.5 py-px text-[10.5px] font-medium',
                active ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-fg-subtle',
              )}
            >
              {item.badge}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <>
      {/* Mobile bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-surface px-4 py-2.5 lg:hidden">
        <Link href="/app" className="text-fg">
          <Logo size={22} />
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          className="rounded-md border border-border px-2.5 py-1.5 text-[12px] text-fg-muted"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </div>

      <aside
        className={cn(
          'z-30 w-full shrink-0 border-border bg-surface lg:sticky lg:top-0 lg:block lg:h-dvh lg:w-[228px] lg:border-r',
          open ? 'block border-b' : 'hidden',
        )}
      >
        <div className="flex h-full flex-col">
          <div className="hidden items-center px-4 py-4 lg:flex">
            <Link href="/app" className="text-fg">
              <Logo size={23} />
            </Link>
          </div>

          <div className="mx-3 mb-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <p className="truncate text-[12.5px] font-medium text-fg">{organizationName}</p>
            <p className="mt-0.5 text-[11px] text-fg-subtle">Analysis as of {asOf}</p>
          </div>

          <nav className="es-scroll flex-1 overflow-y-auto px-3 pb-4">
            <ul className="space-y-0.5">{primary.map(renderItem)}</ul>

            <p className="mt-5 mb-1.5 px-2.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-fg-subtle">
              Tools
            </p>
            <ul className="space-y-0.5">{tools.map(renderItem)}</ul>
          </nav>

          <div className="border-t border-border px-3 py-3">
            <ul className="space-y-0.5">
              {renderItem({ href: '/app/settings', label: 'Settings', icon: IconSettings })}
            </ul>
            <div className="mt-2 flex items-center gap-2.5 rounded-md px-2.5 py-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-[11px] font-semibold text-fg-muted">
                {userName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-fg">{userName}</p>
                <p className="truncate text-[10.5px] text-fg-subtle">{userEmail}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
