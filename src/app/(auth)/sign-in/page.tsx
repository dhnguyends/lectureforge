import type { Metadata } from "next";
import { oauthProviderIds } from "@/auth";
import { oauthSignInAction } from "../actions";
import { SignInForm } from "@/components/auth/auth-forms";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign in" };

const PROVIDER_LABEL: Record<string, string> = { github: "GitHub", google: "Google" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Pick up where you left off.</p>
      </div>
      <SignInForm callbackUrl={callbackUrl} />
      {oauthProviderIds.length > 0 && (
        <div className="space-y-2">
          <p className="text-center text-xs text-muted-foreground">or continue with</p>
          {oauthProviderIds.map((id) => (
            <form key={id} action={oauthSignInAction}>
              <input type="hidden" name="provider" value={id} />
              <Button type="submit" variant="outline" className="w-full">
                {PROVIDER_LABEL[id] ?? id}
              </Button>
            </form>
          ))}
        </div>
      )}
      <p className="text-center text-sm text-muted-foreground">Accounts are created by the administrator.</p>
    </div>
  );
}
