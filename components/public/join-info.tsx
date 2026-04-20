import { Panel } from "@/components/pz/panel";

interface Props {
  address: string;
  port?: number;
  discordUrl?: string;
}

/**
 * Step-by-step join instructions for the public landing.
 * Password reveal is gated behind Discord verification (Phase 3 feature).
 */
export function JoinInfo({ address, port = 16261, discordUrl }: Props) {
  // Strip :port off address if present, for the formatted box
  const host = address.split(":")[0];
  return (
    <Panel title="How to Join" sub="STEP BY STEP">
      <div className="flex flex-col gap-3 text-xs">
        <ol className="flex flex-col gap-2.5 text-pz-text leading-snug pl-0 list-none">
          <li className="flex gap-2">
            <span className="text-pz-primary font-bold pz-mono">1.</span>
            <span>
              Own Project Zomboid on Steam, switch to{" "}
              <span className="pz-mono text-pz-accent">b42unstable</span> beta
              branch.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-pz-primary font-bold pz-mono">2.</span>
            <span>
              In-game: <strong>JOIN</strong> →{" "}
              <strong>Internet</strong> →{" "}
              <strong>Add server</strong> with the address below.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-pz-primary font-bold pz-mono">3.</span>
            <span>
              Steam will auto-download the 53 Workshop mods (≈3 GB, one-time).
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-pz-primary font-bold pz-mono">4.</span>
            <span>Use the password we send you on Discord.</span>
          </li>
        </ol>

        <div className="flex flex-col gap-1">
          <div className="pz-label">IP / HOST</div>
          <div className="pz-mono bg-pz-bg-0 border border-pz-border-lo px-2 py-1.5 text-pz-text select-all">
            {host}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <div className="pz-label">PORT</div>
            <div className="pz-mono bg-pz-bg-0 border border-pz-border-lo px-2 py-1.5 text-pz-text select-all">
              {port}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="pz-label">PASSWORD</div>
            <div className="pz-mono bg-pz-bg-0 border border-pz-border-lo px-2 py-1.5 text-pz-muted tracking-[0.2em]">
              ••••••
            </div>
          </div>
        </div>

        <p className="text-pz-muted leading-snug">
          Password is distributed via Discord after whitelist verification.
          {discordUrl ? (
            <>
              {" "}
              Request access on the{" "}
              <a
                href={discordUrl}
                target="_blank"
                rel="noreferrer"
                className="text-pz-primary underline underline-offset-2"
              >
                Discord server
              </a>
              .
            </>
          ) : (
            " DM the owner on Discord (kashek1) to request access."
          )}
        </p>
      </div>
    </Panel>
  );
}
