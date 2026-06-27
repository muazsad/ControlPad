"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Menu } from "lucide-react";

import { BrandMark } from "@/components/controlpad/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn, isNavActive } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type MobileNavProps = {
  items: NavItem[];
};

export function MobileNav({ items }: MobileNavProps) {
  const pathname = usePathname();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="left-0 top-0 h-dvh max-w-80 translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0 p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:left-0 sm:top-0 sm:translate-x-0 sm:translate-y-0">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
          <div className="border-b border-sidebar-border px-5 py-4">
            <BrandMark />
          </div>
          <nav className="space-y-1 px-3 py-4">
            {items.map((item) => {
              const active = isNavActive(pathname, item.href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active &&
                      "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </DialogContent>
    </Dialog>
  );
}
