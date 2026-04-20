// Vitest setup — DO NOT eagerly import application modules here.
// Specifically: never `import "@/lib/env"` at the top level — it would call
// loadEnv() which requires a complete environment. Tests stub envs per-file.
import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});
