import { z } from "zod";

export const PlayerPerksSchema = z.array(
  z.object({
    name: z.string().min(1),
    level: z.number().int().min(0).max(20),
  })
);
export type PlayerPerks = z.infer<typeof PlayerPerksSchema>;

export const ThemePrefsSchema = z.object({
  accent: z.enum(["green", "amber", "rust", "steel", "blood"]).default("green"),
  intensity: z.enum(["subtle", "balanced", "heavy"]).default("balanced"),
  grain: z.number().min(0).max(0.15).default(0.045),
  scanlines: z.number().min(0).max(0.2).default(0.06),
  startPage: z.string().default("overview"),
});
export type ThemePrefs = z.infer<typeof ThemePrefsSchema>;
