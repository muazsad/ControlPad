"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";

export type AppRole = "admin" | "moderator" | "parent";

type UserMenuProps = {
  fullName: string;
  roleLabel: string;
};

function initialsFor(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function UserMenu({ fullName, roleLabel }: UserMenuProps) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto gap-3 px-2 py-1.5 text-left"
          aria-label="Open account menu"
        >
          <Avatar className="size-9 border border-border">
            <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
              {initialsFor(fullName) || "SI"}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 md:block">
            <span className="block truncate text-sm font-semibold text-foreground">
              {fullName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {roleLabel}
            </span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate">{fullName}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {roleLabel}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="text-status-danger focus:text-status-danger"
        >
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
