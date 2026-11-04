import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { getSupabaseFunctionConfig } from "./supabase-config.ts";
import { finishClaimedNativeRecovery } from "./native-recovery-completion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NativeRecoveryOperation =
  | "authorize-codes"
  | "begin"
  | "attempt"
  | "complete"
  | "cancel";

type RecoveryFactor = {
  id: string;
  factor_type: string;
  status: string;
};

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTransactionToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function generateTransactionToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function hashTransactionToken(token: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`native-recovery-transaction:${token}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function parseBody(request: Request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function handleNativeRecoveryRequest(
  request: Request,
  operation: NativeRecoveryOperation,
) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return response({ error: "Your session is invalid or expired." }, 401);
  }

  const config = getSupabaseFunctionConfig();
  if (!config) {
    return response({
      error: "Recovery service is not configured. Required Supabase URL and default API keys are unavailable.",
    }, 500);
  }
  const hmacSecret = Deno.env.get("RECOVERY_CODE_HMAC_SECRET");
  if (operation !== "authorize-codes" && (!hmacSecret || hmacSecret.length < 32)) {
    return response({
      error: "Recovery service is not configured. Set RECOVERY_CODE_HMAC_SECRET in Supabase Edge Function secrets.",
    }, 500);
  }

  const body = await parseBody(request);
  if (!body) return response({ error: "Invalid request." }, 400);

  const token = authorization.slice("Bearer ".length);
  const authClient = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await authClient.auth.getUser(token);
  const user = userData?.user;
  if (authError || !user) return response({ error: "Your session is invalid or expired." }, 401);

  const userClient = createClient(config.url, config.publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (operation === "authorize-codes") {
    const action = body.action;
    if (action !== "generate" && action !== "regenerate") {
      return response({ error: "Invalid recovery-code management action." }, 400);
    }

    const [{ data: assurance, error: assuranceError }, { data: factorData, error: factorsError }] =
      await Promise.all([
        userClient.auth.mfa.getAuthenticatorAssuranceLevel(),
        userClient.auth.mfa.listFactors(),
      ]);
    if (assuranceError || factorsError) {
      return response({ error: "Could not verify the authenticator session." }, 500);
    }
    if (assurance?.currentLevel !== "aal2") {
      return response({ error: "Verify your existing authenticator to AAL2 before managing recovery codes." }, 403);
    }
    const factors = (factorData?.all || factorData?.totp || []) as RecoveryFactor[];
    if (!factors.some((factor) => factor.factor_type === "totp" && factor.status === "verified")) {
      return response({ error: "A verified TOTP authenticator must remain enrolled to use recovery codes." }, 409);
    }

    const { data: allowed, error: limitError } = await adminClient.rpc("take_recovery_code_rate_limit", {
      p_user_id: user.id,
      p_action: action,
      p_max_attempts: 5,
      p_window_seconds: 3600,
    });
    if (limitError) {
      return response({
        error: "Could not check the recovery-code management rate limit.",
      }, 500);
    }
    if (!allowed) return response({ error: "Too many recovery-code requests. Try again later." }, 429);
    return response({ allowed: true });
  }

  const transactionToken = body.transactionToken;
  if ((operation === "complete" || operation === "cancel") &&
    !isTransactionToken(transactionToken)) {
    return response({ error: "The recovery transaction is invalid or expired." }, 400);
  }

  if (operation === "attempt") {
    const [{ data: assurance, error: assuranceError }, { data: factorData, error: factorsError }] =
      await Promise.all([
        userClient.auth.mfa.getAuthenticatorAssuranceLevel(),
        userClient.auth.mfa.listFactors(),
      ]);
    if (assuranceError || factorsError) {
      return response({ error: "Could not check the authenticator recovery state." }, 500);
    }
    const factors = (factorData?.all || factorData?.totp || []) as RecoveryFactor[];
    const hasNativeRecoveryFactor = factors.some(
      (factor) => factor.factor_type === "recovery_code" && factor.status === "verified",
    );
    const priorFactorIds = factors
      .filter((factor) => factor.factor_type === "totp" && factor.status === "verified")
      .map((factor) => factor.id);
    if (!hasNativeRecoveryFactor || priorFactorIds.length === 0 ||
      priorFactorIds.some((factorId) => !isUuid(factorId))) {
      return response({
        error: "Native recovery codes and at least one verified TOTP authenticator must be enrolled before recovery.",
      }, 409);
    }

    if (assurance?.currentLevel === "aal2") {
      return response({ error: "This session is already at AAL2. Continue with normal account access." }, 409);
    }

    const { data: allowed, error: limitError } = await adminClient.rpc("take_recovery_code_rate_limit", {
      p_user_id: user.id,
      p_action: "verify",
      p_max_attempts: 5,
      p_window_seconds: 900,
    });
    if (limitError) {
      return response({ error: "Could not check the recovery verification rate limit." }, 500);
    }
    if (!allowed) return response({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    return response({ allowed: true });
  }

  if (operation === "begin") {
    const [{ data: assurance, error: assuranceError }, { data: factorData, error: factorsError }] =
      await Promise.all([
        userClient.auth.mfa.getAuthenticatorAssuranceLevel(),
        userClient.auth.mfa.listFactors(),
      ]);
    if (assuranceError || factorsError) {
      return response({ error: "Could not check the authenticator recovery state." }, 500);
    }
    if (assurance?.currentLevel !== "aal2") {
      return response({ error: "Verify a native recovery code and reach AAL2 before starting replacement setup." }, 403);
    }
    const factors = (factorData?.all || factorData?.totp || []) as RecoveryFactor[];
    const hasNativeRecoveryFactor = factors.some(
      (factor) => factor.factor_type === "recovery_code" && factor.status === "verified",
    );
    const priorFactorIds = factors
      .filter((factor) => factor.factor_type === "totp" && factor.status === "verified")
      .map((factor) => factor.id);
    if (!hasNativeRecoveryFactor || priorFactorIds.length === 0 ||
      priorFactorIds.some((factorId) => !isUuid(factorId))) {
      return response({
        error: "A native recovery-code factor and a verified TOTP authenticator are required to start recovery.",
      }, 409);
    }

    const newToken = generateTransactionToken();
    const tokenHash = await hashTransactionToken(newToken, hmacSecret!);
    const { data: startedRows, error: beginError } = await adminClient.rpc(
      "begin_native_mfa_recovery_transaction",
      {
        p_user_id: user.id,
        p_transaction_token_hash: tokenHash,
        p_prior_factor_ids: priorFactorIds,
      },
    );
    if (beginError) {
      return response({
        error: beginError.code === "PGRST202" || beginError.code === "42883"
          ? "The native MFA recovery migration is not installed. Contact support."
          : "Could not start authenticator recovery.",
      }, beginError.code === "PGRST202" || beginError.code === "42883" ? 503 : 500);
    }
    const started = Array.isArray(startedRows) ? startedRows[0] : null;
    if (!started?.started) {
      return response({
        state: started?.state || "pending",
        error: started?.state === "claimed"
          ? "Recovery completion has started. Retry completing that recovery before starting another."
          : "A recovery attempt is already active. Resume or cancel it before starting another.",
      }, 409);
    }
    return response({
      started: true,
      transactionToken: newToken,
      expiresAt: started.expires_at,
    });
  }

  const transactionTokenHash = await hashTransactionToken(transactionToken as string, hmacSecret!);

  if (operation === "cancel") {
    const { data: cancelled, error: cancelError } = await adminClient.rpc(
      "cancel_native_mfa_recovery_transaction",
      {
        p_user_id: user.id,
        p_transaction_token_hash: transactionTokenHash,
      },
    );
    if (cancelError) return response({ error: "Could not cancel authenticator recovery." }, 500);
    return cancelled === "cancelled"
      ? response({ cancelled: true, state: "cancelled" })
      : response({
        cancelled: false,
        state: typeof cancelled === "string" ? cancelled : "not_found",
        error: cancelled === "claimed"
          ? "Recovery completion has been claimed and cannot be cancelled. Retry completion."
          : cancelled === "completed"
          ? "Recovery is already completed."
          : cancelled === "expired"
          ? "The recovery transaction expired before completion. Start a new transaction; the native recovery code remains consumed."
          : "The recovery transaction is no longer active.",
      }, 409);
  }

  if (!isUuid(body.replacementFactorId)) {
    return response({ error: "The replacement authenticator is invalid." }, 400);
  }

  const [{ data: assurance, error: assuranceError }, { data: factorData, error: factorsError }] =
    await Promise.all([
      userClient.auth.mfa.getAuthenticatorAssuranceLevel(),
      userClient.auth.mfa.listFactors(),
    ]);
  if (assuranceError || factorsError) {
    return response({ error: "Could not verify the replacement authenticator session." }, 500);
  }
  if (assurance?.currentLevel !== "aal2") {
    return response({ error: "Verify the replacement authenticator before completing recovery." }, 403);
  }
  const factors = (factorData?.all || factorData?.totp || []) as RecoveryFactor[];
  if (!factors.some((factor) =>
    factor.id === body.replacementFactorId &&
    factor.factor_type === "totp" &&
    factor.status === "verified"
  )) {
    return response({ error: "The replacement authenticator is not verified for this account." }, 403);
  }

  const { data: claimRows, error: claimError } = await adminClient.rpc(
    "claim_native_mfa_recovery_completion",
    {
      p_user_id: user.id,
      p_transaction_token_hash: transactionTokenHash,
      p_replacement_factor_id: body.replacementFactorId,
    },
  );
  if (claimError) return response({ error: "Could not safely claim authenticator recovery completion." }, 500);
  const claim = Array.isArray(claimRows) ? claimRows[0] : null;
  if (claim?.already_completed) {
    return claim.replacement_factor_id === body.replacementFactorId
      ? response({ completed: true, state: "completed" })
      : response({ state: "completed", error: "This recovery transaction was completed with another authenticator." }, 409);
  }
  if (!claim?.claimed || claim.replacement_factor_id !== body.replacementFactorId ||
    !Array.isArray(claim.prior_factor_ids) ||
    claim.prior_factor_ids.some((factorId: unknown) => !isUuid(factorId))) {
    const state = typeof claim?.state === "string" ? claim.state : "not_found";
    return response({
      state,
      error: state === "expired"
        ? "The recovery transaction expired before completion was claimed. Start a new transaction; the native recovery code remains consumed."
        : state === "claimed"
        ? "Recovery completion was claimed for a different replacement authenticator."
        : state === "cancelled"
        ? "This recovery transaction was cancelled."
        : "The recovery transaction is no longer valid.",
    }, 409);
  }

  const completion = await finishClaimedNativeRecovery(
    claim.prior_factor_ids as string[],
    body.replacementFactorId,
    {
      async listFactors() {
        const { data, error } = await userClient.auth.mfa.listFactors();
        return {
          factors: (data?.all || data?.totp || []) as RecoveryFactor[],
          error,
        };
      },
      async getAssurance() {
        const { data, error } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel();
        return { currentLevel: data?.currentLevel ?? null, error };
      },
      async unenroll(factorId) {
        const { error } = await userClient.auth.mfa.unenroll({ factorId });
        return { error };
      },
      async finalize() {
        const { data, error } = await adminClient.rpc(
          "complete_native_mfa_recovery_transaction",
          {
            p_user_id: user.id,
            p_transaction_token_hash: transactionTokenHash,
            p_replacement_factor_id: body.replacementFactorId,
          },
        );
        const result = Array.isArray(data) ? data[0] : null;
        return { completed: result?.completed === true, error };
      },
    },
  );
  return completion.completed
    ? response({ completed: true, state: "completed" })
    : response({
      state: "claimed",
      error: completion.message,
    }, completion.retryable ? 503 : 409);
}
