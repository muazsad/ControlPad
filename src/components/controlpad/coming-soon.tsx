import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/controlpad/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ComingSoonProps = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function ComingSoon({ title, description, icon }: ComingSoonProps) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            This page is wired into the app shell so future phases have a
            stable place to land.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="This section is ready for the next phase"
            description="The navigation works today; real records and workflows will arrive as each planned module is built."
            icon={icon}
          />
        </CardContent>
      </Card>
    </div>
  );
}
