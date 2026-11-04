export type SetupCounts = { scheduleGroups: number; staff: number; students: number; guardians: number; textingVerified: boolean };
export type SetupItem = { key: string; label: string; href: string; done: boolean };

export function buildSetupChecklist(c: SetupCounts): { items: SetupItem[]; complete: boolean } {
  const items: SetupItem[] = [
    { key: "groups", label: "Add a schedule group (days and start times)", href: "/settings#schedule-groups", done: c.scheduleGroups > 0 },
    { key: "staff", label: "Add your teachers", href: "/staff", done: c.staff > 0 },
    { key: "students", label: "Add students", href: "/students", done: c.students > 0 },
    { key: "guardians", label: "Add parents and guardians", href: "/guardians", done: c.guardians > 0 },
    { key: "texting", label: "Connect your Twilio number", href: "/settings#texting", done: c.textingVerified },
  ];
  return { items, complete: items.every((item) => item.done) };
}
