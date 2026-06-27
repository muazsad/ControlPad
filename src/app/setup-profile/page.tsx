import { redirect } from "next/navigation";

import { BrandMark } from "@/components/controlpad/brand";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient, createServiceClient } from "@/lib/supabase/server";

import { SetupProfileForm } from "./setup-profile-form";

export default async function SetupProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfile) redirect("/");

  const admin = createServiceClient();
  const { count } = await admin
    .from("profiles")
    .select("*", { count: "exact", head: true });

  const setupAvailable = (count ?? 0) === 0;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md border shadow-sm">
        <CardHeader className="text-center">
          <div className="mb-2 flex justify-center text-primary">
            <BrandMark />
          </div>
          <CardTitle className="text-2xl font-semibold">
            {setupAvailable ? "Create the first admin" : "Setup unavailable"}
          </CardTitle>
          <CardDescription>
            {setupAvailable
              ? "Finish the bootstrap step for this school workspace."
              : "An admin account already exists. Ask your administrator to assign your role."}
          </CardDescription>
        </CardHeader>
        {setupAvailable ? (
          <CardContent>
            <SetupProfileForm />
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
