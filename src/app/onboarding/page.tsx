import { redirect } from "next/navigation";

import { BrandMark } from "@/components/controlpad/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: schoolId } = await supabase.rpc("current_school_id");
  if (schoolId) redirect("/");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md border shadow-sm">
        <CardHeader className="text-center">
          <div className="mb-2 flex justify-center text-primary"><BrandMark /></div>
          <CardTitle className="text-2xl font-semibold">Set up your school</CardTitle>
          <CardDescription>You&apos;ll be the school&apos;s admin. You can change these later in Settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm />
        </CardContent>
      </Card>
    </div>
  );
}
