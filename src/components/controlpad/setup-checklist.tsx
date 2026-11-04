"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { CheckCircle2, Circle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SetupItem } from "@/lib/schools/setup-checklist";

function hiddenKey(schoolId: string) {
  return `setup-checklist-hidden:${schoolId}`;
}

// "Hidden" lives in localStorage; listeners re-render after Hide is clicked.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function isHidden(schoolId: string): boolean {
  try {
    return window.localStorage.getItem(hiddenKey(schoolId)) === "1";
  } catch {
    return false;
  }
}

/** "Get your school ready" card for a new school's admin. Hideable per browser. */
export function SetupChecklist({ schoolId, items }: { schoolId: string; items: SetupItem[] }) {
  // Hidden on the server render, so there's no flash before localStorage is read.
  const hidden = useSyncExternalStore(subscribe, () => isHidden(schoolId), () => true);
  if (hidden) return null;

  function hide() {
    try {
      window.localStorage.setItem(hiddenKey(schoolId), "1");
    } catch {
      // Storage blocked: nothing to remember, the card stays.
    }
    listeners.forEach((listener) => listener());
  }

  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Get your school ready</CardTitle>
          <CardDescription>
            A few steps before ControlPad can watch attendance, grades and Quran for you.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" className="h-9" onClick={hide}>
          Hide
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-sm">
              {item.done ? (
                <CheckCircle2 className="size-4 shrink-0 text-status-success" aria-hidden="true" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <Link
                href={item.href}
                className={item.done ? "text-muted-foreground line-through" : "font-medium hover:underline"}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="pt-1 text-sm text-muted-foreground">
          Then{" "}
          <Link href="/settings" className="underline">
            review the thresholds and school calendar
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
