import { redirect } from "next/navigation";

// The old "first person becomes admin" bootstrap is gone (multi-tenancy):
// every new user creates their own school instead.
export default function SetupProfilePage() {
  redirect("/onboarding");
}
