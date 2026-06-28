"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  Contact,
  CreditCard,
  Gauge,
  GraduationCap,
  Settings,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/controlpad/brand";
import { MobileNav, type NavItem } from "@/components/controlpad/mobile-nav";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { UserMenu, type AppRole } from "@/components/controlpad/user-menu";
import { Separator } from "@/components/ui/separator";
import { cn, isNavActive } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  fullName: string;
  role: AppRole;
};

export const roleLabels: Record<AppRole, string> = {
  admin: "Administrator",
  moderator: "Moderator",
  parent: "Parent",
};

const operationalNav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: Gauge },
  { href: "/students", label: "Students", icon: Users },
  { href: "/guardians", label: "Guardians", icon: Contact },
  { href: "/grades", label: "Grades", icon: GraduationCap },
  { href: "/top-performers", label: "Top Performers", icon: Trophy },
  { href: "/attendance", label: "Attendance", icon: CalendarDays },
  { href: "/quran", label: "Quran", icon: BookOpen },
];

const adminOnlyNav: NavItem[] = [
  { href: "/tuition", label: "Tuition", icon: CreditCard },
  { href: "/staff", label: "Staff", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

function navForRole(role: AppRole) {
  if (role === "admin") return [...operationalNav, ...adminOnlyNav];
  if (role === "moderator") return operationalNav;
  return [{ href: "/", label: "My children", icon: Users }];
}

function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <aside className="hidden min-h-dvh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
      <div className="border-b border-sidebar-border px-5 py-5">
        <BrandMark />
      </div>
      <nav className="flex-1 space-y-1 px-3 py-5">
        {items.map((item) => {
          const active = isNavActive(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/78 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                active &&
                  "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border px-5 py-4 text-xs leading-5 text-sidebar-foreground/65">
        Early visibility for grades, attendance, Quran, and tuition.
      </div>
    </aside>
  );
}

function ParentShell({ children, fullName, role }: AppShellProps) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <BrandMark />
          <UserMenu
            fullName={fullName}
            roleLabel={roleLabels[role]}
          />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 text-[1.02rem] leading-7 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

export function AppShell({ children, fullName, role }: AppShellProps) {
  if (role === "parent") {
    return <ParentShell fullName={fullName} role={role}>{children}</ParentShell>;
  }

  const items = navForRole(role);

  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <MobileNav items={items} />
              <div className="md:hidden">
                <BrandMark compact />
              </div>
              <div className="hidden min-w-0 md:block">
                <p className="truncate text-sm font-semibold text-primary">
                  ControlPad
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Salaam Institute operations
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={roleLabels[role]} tone="neutral" />
              <Separator orientation="vertical" className="hidden h-8 sm:block" />
              <UserMenu
                fullName={fullName}
                roleLabel={roleLabels[role]}
              />
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
