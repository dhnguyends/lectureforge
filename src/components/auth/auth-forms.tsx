"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useId } from "react";
import { signInAction, unlockAction, type AuthFormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";

function ErrorText({ state }: { state: AuthFormState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {state.error}
    </p>
  );
}

export function SignInForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, action, pending] = useActionState(signInAction, undefined);
  const email = useId();
  const password = useId();
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/dashboard"} />
      <div className="space-y-1.5">
        <Label htmlFor={email}>Email</Label>
        <Input id={email} name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={password}>Password</Label>
        <Input id={password} name="password" type="password" autoComplete="current-password" required />
      </div>
      <ErrorText state={state} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Sign in
      </Button>
    </form>
  );
}

export function AccessForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(unlockAction, undefined);
  const password = useId();
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/"} />
      <div className="space-y-1.5">
        <Label htmlFor={password}>Access password</Label>
        <Input id={password} name="password" type="password" autoComplete="current-password" autoFocus required />
      </div>
      <ErrorText state={state} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Continue
      </Button>
    </form>
  );
}
