/**
 * Reads one setting from the environment. A variable that is set but empty (or only spaces) counts as not set:
 * a shell that exports `ANTHROPIC_API_KEY=` must read as "no key", never as a key of nothing.
 * (Next, like Node, never lets `.env.local` override a variable the shell already defines, even an empty one,
 * and it does not expose the `.env.local` value either, so there is nothing to fall back to. See README, "Secrets".)
 */
export function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}
