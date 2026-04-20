import type { ThemePrefs } from "@/lib/pz/schemas";

const ACCENT_TO_HEX: Record<ThemePrefs["accent"], string> = {
  green: "#7da348",
  amber: "#d4a017",
  rust: "#c56a35",
  steel: "#8aa0b0",
  blood: "#a02c2c",
};

export function applyTheme(prefs: ThemePrefs): void {
  const root = document.documentElement;
  root.style.setProperty("--color-pz-primary", ACCENT_TO_HEX[prefs.accent]);
  const mul = { subtle: 0.5, balanced: 1, heavy: 1.8 }[prefs.intensity];
  root.style.setProperty("--grain-opacity", String(prefs.grain * mul));
  root.style.setProperty("--scanline-opacity", String(prefs.scanlines * mul));
}
