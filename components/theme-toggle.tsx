"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        aria-label="Toggle theme"
        className="relative h-8 w-8 shrink-0 px-0"
      />
    );
  }

  const Icon = theme === "dark" ? Moon : Sun;

  return (
    <Button
      variant="ghost"
      onClick={toggle}
      aria-label="Toggle theme"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="relative h-8 w-8 shrink-0 px-0"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}