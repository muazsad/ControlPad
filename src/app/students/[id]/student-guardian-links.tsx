"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Link2, Star, Unlink } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/controlpad/empty-state";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Guardian } from "@/lib/people/people";
import { linkGuardian, unlinkGuardian, type ActionState } from "../actions";

export type LinkedGuardian = Guardian & {
  relationship: string | null;
  is_primary: boolean;
};

type Props = {
  studentId: string;
  linked: LinkedGuardian[];
  available: Guardian[];
  canManage: boolean;
};

function SubmitButton({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant?: "ghost" | "outline" | "default";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {children}
    </Button>
  );
}

export function StudentGuardianLinks({
  studentId,
  linked,
  available,
  canManage,
}: Props) {
  const [linkState, linkAction] = useActionState<ActionState, FormData>(
    linkGuardian,
    { error: null },
  );
  const [unlinkState, unlinkAction] = useActionState<ActionState, FormData>(
    unlinkGuardian,
    { error: null },
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (linkState.error) {
      toast.error("Could not link guardian", { description: linkState.error });
    }
  }, [linkState]);

  useEffect(() => {
    if (unlinkState.error) {
      toast.error("Could not unlink guardian", {
        description: unlinkState.error,
      });
    }
  }, [unlinkState]);

  return (
    <div className="space-y-5">
      {linked.length === 0 ? (
        <EmptyState
          title="No guardians linked"
          description="Link a guardian so this student's parents can receive alerts and, optionally, sign in."
          icon={Link2}
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {linked.map((g) => (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{g.full_name}</span>
                  {g.is_primary ? (
                    <StatusBadge status="Primary" tone="success" />
                  ) : null}
                  {g.user_id ? (
                    <StatusBadge status="Has login" tone="neutral" />
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {g.relationship ? `${g.relationship} · ` : ""}
                  {g.phone}
                </p>
              </div>
              {canManage ? (
                <form action={unlinkAction}>
                  <input type="hidden" name="student_id" value={studentId} />
                  <input type="hidden" name="guardian_id" value={g.id} />
                  <SubmitButton variant="ghost">
                    <Unlink className="size-4" aria-hidden="true" />
                    Unlink
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All guardians are already linked.{" "}
            <Link href="/guardians/new" className="text-primary hover:underline">
              Create a new guardian
            </Link>{" "}
            to link another.
          </p>
        ) : (
          <form
            ref={formRef}
            action={linkAction}
            className="rounded-xl border bg-muted/40 p-4"
          >
            <input type="hidden" name="student_id" value={studentId} />
            <p className="mb-3 text-sm font-semibold">Link a guardian</p>
            <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="guardian_id">Guardian</Label>
                <Select name="guardian_id">
                  <SelectTrigger id="guardian_id" className="h-10 w-full">
                    <SelectValue placeholder="Select guardian" />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.full_name} · {g.phone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="relationship">Relationship</Label>
                <Input
                  id="relationship"
                  name="relationship"
                  placeholder="mother, father…"
                />
              </div>
              <SubmitButton variant="default">
                <Link2 className="size-4" aria-hidden="true" />
                Link
              </SubmitButton>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                name="is_primary"
                className="size-4 rounded border-input"
              />
              <Star className="size-3.5" aria-hidden="true" />
              Mark as primary contact
            </label>
          </form>
        )
      ) : null}
    </div>
  );
}
