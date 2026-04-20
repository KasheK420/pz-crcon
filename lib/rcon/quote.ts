/**
 * Quote a value as a double-quoted argument for the PZ RCON console.
 *
 * Strips embedded double quotes (RCON has no escaping — safer to drop
 * them than produce a malformed command). Also collapses newlines and
 * trims whitespace. The result is always wrapped in `"..."`.
 */
export function quoteArg(value: string): string {
  const cleaned = value
    .replace(/["\r\n]/g, "")
    .trim();
  return `"${cleaned}"`;
}

/**
 * Build an RCON command by joining a head with already-quoted args.
 * Example: buildCommand("kick", ["Player One", "griefing"]) →
 *   `kick "Player One" "griefing"`
 */
export function buildCommand(head: string, args: string[]): string {
  return [head, ...args.map(quoteArg)].join(" ");
}
