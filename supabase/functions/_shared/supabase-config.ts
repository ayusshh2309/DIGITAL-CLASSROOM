export interface SupabaseFunctionConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

function getDefaultKey(
  currentVariable: string,
  legacyVariable: string,
): string | null {
  const currentValue = Deno.env.get(currentVariable);
  if (currentValue !== undefined) {
    try {
      const keySet: unknown = JSON.parse(currentValue);
      if (
        !keySet ||
        typeof keySet !== "object" ||
        Array.isArray(keySet)
      ) {
        return null;
      }

      const defaultKey = (keySet as Record<string, unknown>).default;
      return typeof defaultKey === "string" && defaultKey.trim()
        ? defaultKey.trim()
        : null;
    } catch {
      return null;
    }
  }

  const legacyValue = Deno.env.get(legacyVariable);
  return legacyValue?.trim() || null;
}

export function getSupabaseFunctionConfig(): SupabaseFunctionConfig | null {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const publishableKey = getDefaultKey(
    "SUPABASE_PUBLISHABLE_KEYS",
    "SUPABASE_ANON_KEY",
  );
  const secretKey = getDefaultKey(
    "SUPABASE_SECRET_KEYS",
    "SUPABASE_SERVICE_ROLE_KEY",
  );

  if (!url || !publishableKey || !secretKey) return null;
  return { url, publishableKey, secretKey };
}
