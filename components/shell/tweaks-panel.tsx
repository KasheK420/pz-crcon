"use client";
import { useEffect, useState } from "react";
import { applyTheme } from "@/lib/theme/apply";
import { ThemePrefsSchema, type ThemePrefs } from "@/lib/pz/schemas";

export function TweaksPanel() {
  const [prefs, setPrefs] = useState<ThemePrefs | null>(null);

  useEffect(() => {
    fetch("/api/me/theme")
      .then((r) => r.json())
      .then((d) => {
        const p = ThemePrefsSchema.parse(d.prefs);
        setPrefs(p);
        applyTheme(p);
      })
      .catch(() => {
        // Silently ignore — unauthenticated users or transient errors.
      });
  }, []);

  function update(patch: Partial<ThemePrefs>) {
    if (!prefs) return;
    const next = ThemePrefsSchema.parse({ ...prefs, ...patch });
    setPrefs(next);
    applyTheme(next);
    fetch("/api/me/theme", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
  }

  if (!prefs) return null;
  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <span className="stencil">TWEAKS</span>
      </div>
      <div className="tweaks-body">
        <div className="tweak-row">
          <span className="label">ACCENT</span>
          <select
            value={prefs.accent}
            onChange={(e) =>
              update({ accent: e.target.value as ThemePrefs["accent"] })
            }
          >
            {(["green", "amber", "rust", "steel", "blood"] as const).map(
              (a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              )
            )}
          </select>
        </div>
        <div className="tweak-row">
          <span className="label">INTENSITY</span>
          <select
            value={prefs.intensity}
            onChange={(e) =>
              update({ intensity: e.target.value as ThemePrefs["intensity"] })
            }
          >
            <option value="subtle">subtle</option>
            <option value="balanced">balanced</option>
            <option value="heavy">heavy</option>
          </select>
        </div>
      </div>
    </div>
  );
}
