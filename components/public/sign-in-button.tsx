import { signIn } from "@/auth";

/**
 * Server-action sign-in button. Auth.js v5 requires a POST (with CSRF) to
 * start OAuth — direct GET to `/api/auth/signin/discord` triggers
 * UnknownAction. Wrapping the call in a Next.js server action handles the
 * CSRF token and redirect for us.
 */
export function SignInButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("discord", { redirectTo: "/admin" });
      }}
    >
      <button
        type="submit"
        className="pz-pill cursor-pointer border-0"
        style={{
          background: "#5865f2",
          color: "white",
          padding: "4px 12px",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        Sign in with Discord
      </button>
    </form>
  );
}
