import { Panel } from "@/components/pz/panel";

/**
 * Phase 1 join panel: reveals server address, gates password entirely.
 * Discord verification flow (auto-DM password on role assignment)
 * lands in Phase 3.
 */
export function JoinInfo({
  address,
  discordUrl,
}: {
  address: string;
  discordUrl?: string;
}) {
  return (
    <Panel title="How to Join">
      <div className="flex flex-col gap-3 text-xs">
        <div className="flex flex-col gap-1">
          <div className="pz-label">SERVER ADDRESS</div>
          <div className="pz-mono bg-pz-bg-0 border border-pz-border-lo px-2 py-1.5 text-pz-text">
            {address}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="pz-label">PASSWORD</div>
          <div className="pz-mono bg-pz-bg-0 border border-pz-border-lo px-2 py-1.5 text-pz-muted tracking-[0.2em]">
            •••••••• <span className="text-pz-accent ml-2">[gated]</span>
          </div>
          <p className="text-pz-muted leading-snug mt-1">
            Password is distributed via Discord after whitelist verification.
            {discordUrl ? (
              <>
                {" "}
                Request access on our{" "}
                <a
                  href={discordUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-pz-primary underline underline-offset-2"
                >
                  Discord
                </a>
                .
              </>
            ) : (
              " Contact the owner on Discord to request access."
            )}
          </p>
        </div>
      </div>
    </Panel>
  );
}
