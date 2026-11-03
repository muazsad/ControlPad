"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JUZ_MAX, JUZ_MIN } from "@/lib/quran/lessons";

import { finishJuzTest, startJuzTest } from "../actions";

export type JuzTestView = {
  id: string;
  juz: number;
  startedOn: string;
  finishedOn: string | null;
};

/**
 * Start / finish a juz test. While one is open, sabaq, sabaq para and dhor
 * aren't expected: Quran and revision alerts pause until it's finished.
 */
export function JuzTestPanel({
  studentId,
  tests,
  today,
  suggestedJuz,
  canEdit,
}: {
  studentId: string;
  /** Newest first. */
  tests: JuzTestView[];
  today: string;
  suggestedJuz: number;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [juz, setJuz] = useState(String(suggestedJuz));
  const [date, setDate] = useState(today);
  const open = tests.find((test) => test.finishedOn === null) ?? null;
  const history = tests.filter((test) => test.finishedOn !== null);

  function start() {
    startTransition(async () => {
      const result = await startJuzTest({ studentId, juz: Number(juz), startedOn: date });
      if (result.error) toast.error("Could not start juz test", { description: result.error });
      else toast.success(`Juz ${juz} test started`);
    });
  }

  function finish(test: JuzTestView) {
    startTransition(async () => {
      const result = await finishJuzTest({ studentId, testId: test.id, finishedOn: date });
      if (result.error) toast.error("Could not finish juz test", { description: result.error });
      else toast.success(`Juz ${test.juz} test finished and marked memorized`);
    });
  }

  return (
    <div className="space-y-4">
      {open ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-status-warning/40 bg-status-warning-soft px-4 py-3">
          <StatusBadge status={`On juz test · Juz ${open.juz}`} tone="warning" />
          <span className="text-sm text-muted-foreground">Since {open.startedOn}</span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No juz test in progress.</p>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3">
          {open ? null : (
            <div className="space-y-2">
              <Label htmlFor="juz-test-juz">Juz</Label>
              <select
                id="juz-test-juz"
                value={juz}
                onChange={(event) => setJuz(event.target.value)}
                className="h-10 w-24 rounded-md border border-input bg-background px-3 text-sm"
              >
                {Array.from({ length: JUZ_MAX - JUZ_MIN + 1 }, (_, i) => JUZ_MIN + i).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="juz-test-date">{open ? "Finish date" : "Start date"}</Label>
            <Input
              id="juz-test-date"
              type="date"
              value={date}
              max={today}
              onChange={(event) => setDate(event.target.value)}
              className="h-10 w-40"
            />
          </div>
          {open ? (
            <Button type="button" disabled={pending || !date} onClick={() => finish(open)} className="h-10">
              {pending ? "Saving…" : `Finish Juz ${open.juz} test`}
            </Button>
          ) : (
            <Button type="button" disabled={pending || !date} onClick={start} className="h-10">
              {pending ? "Saving…" : "Start juz test"}
            </Button>
          )}
        </div>
      ) : null}

      {history.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {history.map((test) => (
            <li key={test.id} className="text-muted-foreground">
              <span className="font-medium text-foreground">Juz {test.juz}</span> · {test.startedOn} → {test.finishedOn}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
