import { LayoutDashboard, LogOut, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  // A deleted account keeps a signed session cookie: send it back to sign-in.
  if (!session.user.id || !(await db.user.findUnique({ where: { id: session.user.id }, select: { id: true } }))) redirect("/sign-in");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
          <Brand href="/dashboard" />
          <nav aria-label="Main" className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">
                <LayoutDashboard aria-hidden />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>
            </Button>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Button asChild size="sm">
              <Link href="/study-sets/new">
                <Plus aria-hidden />
                <span className="hidden sm:inline">New study set</span>
                <span className="sm:hidden">New</span>
              </Link>
            </Button>
            <ThemeToggle />
            {/* The admin page is served by the control service, not by this app: a plain link (full navigation). */}
            <Button asChild variant="ghost" size="icon">
              <a href="/admin" aria-label="Admin settings" title="Admin settings">
                <Settings />
              </a>
            </Button>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <Button variant="ghost" size="icon" type="submit" aria-label={`Sign out ${session.user.email ?? ""}`.trim()}>
                <LogOut />
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
