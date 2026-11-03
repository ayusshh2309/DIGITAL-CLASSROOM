import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const encoder = new TextEncoder();

type RecoveryOperation =
  | "generate"
  | "regenerate"
  | "verify"
  | "complete"
  | "cancel"
  | "count";

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store" },
  });
}

function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function encodeBase32(bytes: Uint8Array) {
  let value = 0;
  let bits = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function formatCode(code: string) {
  return code.match(/.{1,5}/g)?.join("-") ?? code;
}

async function hashCode(code: string, secret: string) {
  return hmacHex(normalizeCode(code), secret);
}

async function hashTransactionToken(token: string, secret: string) {
  return hmacHex(`recovery-transaction:${token}`, secret);
}

async function hmacHex(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateTransactionToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function generateCodes() {
  const codes = new Set<string>();
  while (codes.size < 10) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    codes.add(encodeBase32(bytes));
  }
  return [...codes].map(formatCode);
}

function logEvent(userId: string, event: string, success: boolean) {
  console.info("recovery_codes_event", JSON.stringify({
    userId,
    event,
    success,
    timestamp: new Date().toISOString(),
  }));
}

function logDatabaseError(event: string, error: { code?: string; message?: string }) {
  console.error("recovery_codes_database_error", JSON.stringify({
    event,
    code: error.code ?? "unknown",
    message: error.message ?? "Unknown database error.",
  }));
}

function isMissingRecoverySchema(error: { code?: string }) {
  return error.code === "PGRST202" || error.code === "PGRST205" ||
    error.code === "42P01" || error.code === "42883";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTransactionToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

async function parseBody(request: Request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function getVerifiedTokenAal(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return claims.aal;
  } catch {
    return null;
  }
}

export async function handleRecoveryRequest(request: Request, operation: RecoveryOperation) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hmacSecret = Deno.env.get("RECOVERY_CODE_HMAC_SECRET");
  if (!authorization?.startsWith("Bearer ") || !url || !anonKey || !serviceRoleKey) {
    const missing = [
      ["SUPABASE_URL", url],
      ["SUPABASE_ANON_KEY", anonKey],
      ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
    ].filter(([, value]) => !value).map(([name]) => name);
    return response({
      error: `Recovery-code service is not configured. Missing server setting${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    }, 500);
  }
  const secretRequired = operation !== "count";
  if (secretRequired && (!hmacSecret || hmacSecret.length < 32)) {
    return response({
      error: "Recovery-code service is not configured. Set RECOVERY_CODE_HMAC_SECRET in Supabase Edge Function secrets.",
    }, 500);
  }

  const body = await parseBody(request);
  if (!body) return response({ error: "Invalid request." }, 400);

  const token = authorization.slice("Bearer ".length);
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return response({ error: "Your session is invalid or expired." }, 401);
  if ((operation === "generate" || operation === "regenerate") && getVerifiedTokenAal(token) !== "aal2") {
    logEvent(user.id, `${operation}_aal2_required`, false);
    return response({ error: "Verify your authenticator before managing recovery codes." }, 403);
  }

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (operation === "count") {
    const [{ count: remaining, error: remainingError }, { count: total, error: totalError }] =
      await Promise.all([
        adminClient.from("user_recovery_codes").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).is("used_at", null),
        adminClient.from("user_recovery_codes").select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
      ]);
    const error = remainingError ?? totalError;
    if (error) {
      logDatabaseError("count", error);
      logEvent(user.id, "count", false);
      return response({
        error: isMissingRecoverySchema(error)
          ? "The recovery-code database migration is missing. Apply the recovery-code migration and try again."
          : "Could not load recovery-code status.",
      }, isMissingRecoverySchema(error) ? 503 : 500);
    }
    return response({ remaining: remaining ?? 0, hasCodes: (total ?? 0) > 0 });
  }

  if (operation === "verify") {
    const { data: allowed, error: limitError } = await adminClient.rpc("take_recovery_code_rate_limit", {
      p_user_id: user.id,
      p_action: "verify",
      p_max_attempts: 5,
      p_window_seconds: 900,
    });
    if (limitError) {
      logDatabaseError("verify_rate_limit", limitError);
      logEvent(user.id, "verify_rate_limit", false);
      return response({
        error: isMissingRecoverySchema(limitError)
          ? "The recovery-code database migration is missing. Apply the recovery-code migration and try again."
          : "Could not verify the recovery code.",
      }, isMissingRecoverySchema(limitError) ? 503 : 500);
    }
    if (!allowed) {
      logEvent(user.id, "verify_rate_limited", false);
      return response({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    }

    const submittedCode = body.code;
    if (typeof submittedCode !== "string" || normalizeCode(submittedCode).length !== 26) {
      logEvent(user.id, "verify", false);
      return response({ valid: false });
    }
    const codeHash = await hashCode(submittedCode, hmacSecret!);
    const { data: factorData, error: factorsError } = await userClient.auth.mfa.listFactors();
    if (factorsError) {
      logEvent(user.id, "verify_factor_list", false);
      return response({ error: "Could not check the account's existing authenticator." }, 500);
    }
    const priorFactorIds = (factorData?.all || factorData?.totp || [])
      .filter((factor) => factor.factor_type === "totp" && factor.status === "verified")
      .map((factor) => factor.id);
    if (priorFactorIds.some((id) => !isUuid(id))) {
      logEvent(user.id, "verify_no_verified_factor", false);
      return response({ error: "The account's authenticator state could not be verified for recovery." }, 409);
    }

    const transactionToken = generateTransactionToken();
    const transactionTokenHash = await hashTransactionToken(transactionToken, hmacSecret!);
    const { data: transaction, error: transactionError } = await adminClient.rpc(
      "begin_user_recovery_transaction",
      {
        p_user_id: user.id,
        p_code_hash: codeHash,
        p_transaction_token_hash: transactionTokenHash,
        p_prior_factor_ids: priorFactorIds,
      },
    );
    if (transactionError) {
      logDatabaseError("verify_begin_transaction", transactionError);
      logEvent(user.id, "verify", false);
      return response({
        error: isMissingRecoverySchema(transactionError)
          ? "The recovery-transaction database migration is missing. Apply the recovery-code migrations and try again."
          : "Could not start authenticator recovery.",
      }, isMissingRecoverySchema(transactionError) ? 503 : 500);
    }
    const started = Array.isArray(transaction) ? transaction[0] : null;
    if (!started?.started) {
      logEvent(user.id, "verify", false);
      return response({ valid: false, error: "That code is invalid, already used, or has an active recovery attempt." });
    }
    logEvent(user.id, "verify_transaction_started", true);
    return response({
      valid: true,
      transactionToken,
      expiresAt: started.expires_at,
    });
  }

  if (operation === "complete") {
    if (!isTransactionToken(body.transactionToken) || !isUuid(body.replacementFactorId)) {
      return response({ error: "The recovery transaction is invalid or expired." }, 400);
    }

    const [{ data: assurance, error: assuranceError }, { data: factorData, error: factorsError }] =
      await Promise.all([
        userClient.auth.mfa.getAuthenticatorAssuranceLevel(),
        userClient.auth.mfa.listFactors(),
      ]);
    if (assuranceError || factorsError) {
      logEvent(user.id, "complete_mfa_check", false);
      return response({ error: "Could not verify the new authenticator session." }, 500);
    }
    if (assurance?.currentLevel !== "aal2") {
      logEvent(user.id, "complete_aal2_required", false);
      return response({ error: "Verify the new authenticator before completing recovery." }, 403);
    }
    const factors = factorData?.all || factorData?.totp || [];
    const verifiedFactors = factors
      .filter((factor) => factor.factor_type === "totp" && factor.status === "verified");
    if (!verifiedFactors.some((factor) => factor.id === body.replacementFactorId)) {
      logEvent(user.id, "complete_replacement_factor_not_verified", false);
      return response({ error: "The replacement authenticator is not verified for this account." }, 403);
    }

    const transactionTokenHash = await hashTransactionToken(body.transactionToken, hmacSecret!);
    const { data: transactionRows, error: transactionLookupError } = await adminClient.rpc(
      "get_user_recovery_transaction",
      {
        p_user_id: user.id,
        p_transaction_token_hash: transactionTokenHash,
      },
    );
    if (transactionLookupError) {
      logDatabaseError("complete_transaction_lookup", transactionLookupError);
      logEvent(user.id, "complete", false);
      return response({
        error: isMissingRecoverySchema(transactionLookupError)
          ? "The recovery-transaction database migration is missing. Apply the recovery-code migrations and try again."
          : "Could not load authenticator recovery status.",
      }, isMissingRecoverySchema(transactionLookupError) ? 503 : 500);
    }
    const transaction = Array.isArray(transactionRows) ? transactionRows[0] : null;
    if (!transaction?.found) {
      logEvent(user.id, "complete", false);
      return response({ error: "The recovery transaction expired or is no longer valid. Start recovery again." }, 409);
    }
    if (transaction.completed) {
      if (transaction.replacement_factor_id !== body.replacementFactorId) {
        return response({ error: "This recovery transaction was completed with another authenticator." }, 409);
      }
      return response({ completed: true });
    }
    if (!Array.isArray(transaction.prior_factor_ids) ||
      transaction.prior_factor_ids.includes(body.replacementFactorId)) {
      logEvent(user.id, "complete_invalid_replacement", false);
      return response({ error: "The replacement authenticator must be newly enrolled for this recovery." }, 409);
    }

    const { data: claimRows, error: claimError } = await adminClient.rpc(
      "claim_user_recovery_completion",
      {
        p_user_id: user.id,
        p_transaction_token_hash: transactionTokenHash,
        p_replacement_factor_id: body.replacementFactorId,
      },
    );
    if (claimError) {
      logDatabaseError("claim_completion", claimError);
      logEvent(user.id, "complete_claim", false);
      return response({
        error: isMissingRecoverySchema(claimError)
          ? "The recovery-transaction database migration is missing. Apply the recovery-code migrations and try again."
          : "Could not safely claim authenticator recovery completion.",
      }, isMissingRecoverySchema(claimError) ? 503 : 500);
    }
    const claim = Array.isArray(claimRows) ? claimRows[0] : null;
    if (claim?.already_completed) {
      return claim.replacement_factor_id === body.replacementFactorId
        ? response({ completed: true })
        : response({ error: "This recovery transaction was completed with another authenticator." }, 409);
    }
    if (!claim?.claimed || claim.replacement_factor_id !== body.replacementFactorId ||
      !Array.isArray(claim.prior_factor_ids) ||
      claim.prior_factor_ids.some((factorId: unknown) => !isUuid(factorId))) {
      logEvent(user.id, "complete_claim", false);
      return response({
        error: claim?.replacement_factor_id
          ? "This recovery transaction is already being completed with another authenticator."
          : "The recovery transaction expired or is no longer valid. Start recovery again.",
      }, 409);
    }

    for (const oldFactorId of claim.prior_factor_ids) {
      if (!factors.some((factor) => factor.id === oldFactorId)) continue;
      const { error: unenrollError } = await userClient.auth.mfa.unenroll({ factorId: oldFactorId });
      if (unenrollError) {
        logEvent(user.id, "complete_old_factor_removal", false);
        return response({
          error: "The replacement authenticator is verified, but an old authenticator could not be removed. Retry recovery completion.",
        }, 409);
      }
    }

    const [{ data: finalAssurance, error: finalAssuranceError }, { data: finalFactorData, error: finalFactorsError }] =
      await Promise.all([
        userClient.auth.mfa.getAuthenticatorAssuranceLevel(),
        userClient.auth.mfa.listFactors(),
      ]);
    if (finalAssuranceError || finalFactorsError) {
      logEvent(user.id, "complete_final_mfa_check", false);
      return response({
        error: "Could not confirm the replacement authenticator after removing old factors. Retry recovery completion.",
      }, 500);
    }
    const finalFactors = finalFactorData?.all || finalFactorData?.totp || [];
    if (finalAssurance?.currentLevel !== "aal2" ||
      !finalFactors.some((factor) =>
        factor.id === body.replacementFactorId &&
        factor.factor_type === "totp" &&
        factor.status === "verified"
      )) {
      logEvent(user.id, "complete_final_replacement_check", false);
      return response({
        error: "The replacement authenticator is no longer verified at AAL2. Your recovery code remains unused; verify a replacement authenticator and retry.",
      }, 409);
    }

    const { data: completedRows, error: completionError } = await adminClient.rpc(
      "complete_user_recovery_transaction",
      {
        p_user_id: user.id,
        p_transaction_token_hash: transactionTokenHash,
        p_replacement_factor_id: body.replacementFactorId,
      },
    );
    if (completionError) {
      logDatabaseError("complete_transaction", completionError);
      logEvent(user.id, "complete", false);
      return response({
        error: isMissingRecoverySchema(completionError)
          ? "The recovery-transaction database migration is missing. Apply the recovery-code migrations and try again."
          : "Could not complete authenticator recovery.",
      }, isMissingRecoverySchema(completionError) ? 503 : 500);
    }
    const completed = Array.isArray(completedRows) ? completedRows[0] : null;
    if (!completed?.completed) {
      logEvent(user.id, "complete", false);
      return response({ error: "The recovery transaction expired or is no longer valid. Start recovery again." }, 409);
    }
    logEvent(user.id, "complete", true);
    return response({ completed: true });
  }

  if (operation === "cancel") {
    if (!isTransactionToken(body.transactionToken)) {
      return response({ error: "The recovery transaction is invalid or expired." }, 400);
    }
    const transactionTokenHash = await hashTransactionToken(body.transactionToken, hmacSecret!);
    const { data: cancelled, error: cancelError } = await adminClient.rpc(
      "cancel_user_recovery_transaction",
      {
        p_user_id: user.id,
        p_transaction_token_hash: transactionTokenHash,
      },
    );
    if (cancelError) {
      logDatabaseError("cancel_transaction", cancelError);
      logEvent(user.id, "cancel", false);
      return response({
        error: isMissingRecoverySchema(cancelError)
          ? "The recovery-transaction database migration is missing. Apply the recovery-code migrations and try again."
          : "Could not cancel authenticator recovery.",
      }, isMissingRecoverySchema(cancelError) ? 503 : 500);
    }
    logEvent(user.id, "cancel", Boolean(cancelled));
    return response({ cancelled: Boolean(cancelled) });
  }

  const rateAction = operation === "regenerate" ? "regenerate" : "generate";
  const { data: allowed, error: limitError } = await adminClient.rpc("take_recovery_code_rate_limit", {
    p_user_id: user.id,
    p_action: rateAction,
    p_max_attempts: 5,
    p_window_seconds: 3600,
  });
  if (limitError) {
    logDatabaseError(`${rateAction}_rate_limit`, limitError);
    logEvent(user.id, `${rateAction}_rate_limit`, false);
    return response({
      error: isMissingRecoverySchema(limitError)
        ? "The recovery-code database migration is missing. Apply the recovery-code migration and try again."
        : "Could not prepare recovery codes.",
    }, isMissingRecoverySchema(limitError) ? 503 : 500);
  }
  if (!allowed) {
    logEvent(user.id, `${rateAction}_rate_limited`, false);
    return response({ error: "Too many requests. Try again later." }, 429);
  }

  const codes = generateCodes();
  const hashes = await Promise.all(codes.map((code) => hashCode(code, hmacSecret!)));
  const { data: stored, error: storeError } = await adminClient.rpc("replace_user_recovery_codes", {
    p_user_id: user.id,
    p_code_hashes: hashes,
    p_regenerate: operation === "regenerate",
  });
  if (storeError) {
    logDatabaseError(`${rateAction}_store`, storeError);
    logEvent(user.id, rateAction, false);
    return response({
      error: isMissingRecoverySchema(storeError)
        ? "The recovery-code database migration is missing. Apply the recovery-code migration and try again."
        : "Could not save recovery codes.",
    }, isMissingRecoverySchema(storeError) ? 503 : 500);
  }
  if (!stored) {
    logEvent(user.id, "generate_already_exists", false);
    return response({ error: "Recovery codes already exist. Regenerate them instead." }, 409);
  }

  logEvent(user.id, rateAction, true);
  return response({ codes, remaining: codes.length, hasCodes: true });
}
