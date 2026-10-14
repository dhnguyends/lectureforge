import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Brand />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
