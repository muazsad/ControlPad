"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { BrandMark } from "@/components/controlpad/brand";
import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    setLoading(false);

    if (error) {
      setError(error.message);
      toast.error("Sign up failed", { description: error.message });
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center text-primary">
          <BrandMark />
        </div>

        <Card className="border shadow-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-semibold">
              {sent ? "Check your email" : "Create your school"}
            </CardTitle>
            <CardDescription>
              {sent
                ? `We sent a confirmation link to ${email}. Open it to finish setting up your school.`
                : "Start with your own account. You'll name your school next."}
            </CardDescription>
          </CardHeader>
          {sent ? null : (
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && <InlineError message={error} />}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <Button type="submit" disabled={loading} className="h-10 w-full">
                  {loading ? "Creating account..." : "Create account"}
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <Link href="/login" className="underline">
                    Sign in
                  </Link>
                </p>
              </form>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
