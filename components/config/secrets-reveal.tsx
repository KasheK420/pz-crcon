"use client";

/**
 * OWNER-only click-to-reveal for redacted INI secrets.
 *
 * VIEWER/MODERATOR/ADMIN only see a locked dots placeholder: there is no
 * way to trigger the reveal endpoint client-side for those roles. OWNERs
 * see a "reveal" button — clicking it fetches
 * `/api/admin/config/ini/secrets` and swaps the placeholder for the
 * real value (which can then be edited and saved via the normal PUT path).
 */

import { useState } from "react";
import { csrfFetch } from "@/lib/csrf/fetch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  /** The INI key (e.g. "RCONPassword"). */
  keyName: string;
  /** Whether the viewing role can reveal (OWNER). */
  canReveal: boolean;
  /** Current in-flight buffer value; undefined until revealed. */
  value: string | undefined;
  /** Propagate edits back to the edit buffer. */
  onChange: (value: string) => void;
}

export function SecretsReveal({ keyName, canReveal, value, onChange }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canReveal) {
    return (
      <span className="pz-mono text-pz-muted text-xs" title="OWNER required">
        ••••••
      </span>
    );
  }

  if (!revealed) {
    return (
      <div className="flex items-center gap-2">
        <span className="pz-mono text-pz-muted text-xs">••••••</span>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setError(null);
            try {
              const res = await csrfFetch(
                "/api/admin/config/ini/secrets",
                { method: "GET" },
              );
              if (!res.ok) {
                setError(`reveal failed (${res.status})`);
                return;
              }
              const j = (await res.json()) as {
                ok: boolean;
                secrets?: Record<string, string>;
              };
              if (!j.ok) {
                setError("reveal denied");
                return;
              }
              onChange(j.secrets?.[keyName] ?? "");
              setRevealed(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "reveal error");
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? "..." : "reveal"}
        </Button>
        {error && <span className="text-pz-danger text-xs">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={value ?? ""}
        onChange={(ev) => onChange(ev.currentTarget.value)}
        className="pz-mono"
      />
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() => setRevealed(false)}
        title="Hide"
      >
        hide
      </Button>
    </div>
  );
}
