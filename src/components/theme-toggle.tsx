"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("lf-theme", next ? "dark" : "light");
    } catch {
      // Storage unavailable (private mode); the choice lasts for this page only.
    }
  };

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
