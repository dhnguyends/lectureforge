import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccessForm } from "@/components/auth/auth-forms";
import { accessKey } from "@/lib/access-gate";

export const metadata: Metadata = { title: "Private site", robots: { index: false, follow: false } };

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (!accessKey()) redirect("/");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Private site</h1>
        <p className="text-sm text-muted-foreground">Enter the access password to continue. You will then sign in with your own account.</p>
      </div>
      <AccessForm next={next} />
    </div>
  );
}
