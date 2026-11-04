(() => {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const currentFolder = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "";
  const nestedAppFolder = [
    "teacher_content",
    "student_content",
    "teacher_registration",
    "student_registration",
  ].includes(currentFolder);
  const appRoot = new URL(nestedAppFolder ? "../" : "./", window.location.href);
  const LOGIN_URL = new URL("teacher_registration/login.html", appRoot);
  const VERIFY_URL = new URL("verify-2fa.html", appRoot);
  const TEACHER_DASHBOARD = new URL("teacher_content/teacher_dashboard.html", appRoot);
  const STUDENT_DASHBOARD = new URL("student_content/st_dashboard.html", appRoot);

  function getClient() {
    const client = window.SmartLearningSupabase?.getClient?.();
    if (!client) throw new Error("Supabase is not configured.");
    return client;
  }

  async function getFunctionErrorMessage(error, functionName) {
    if (error?.context instanceof Response && error.context.status === 404) {
      return `The ${functionName} Edge Function is not deployed to this Supabase project.`;
    }
    if (error?.context instanceof Response) {
      try {
        const body = await error.context.clone().json();
        if (typeof body?.error === "string" && body.error.trim()) return body.error;
      } catch {
        // Fall back to the SDK error when the response is not JSON.
      }
    }
    if (
      error?.name === "FunctionsFetchError" ||
      /failed to send a request to the edge function/i.test(error?.message || "")
    ) {
      return `The ${functionName} Edge Function could not be reached. Deploy it to your linked Supabase project and try again.`;
    }
    return error?.message || `The ${functionName} Edge Function failed.`;
  }

  function recoveryError(message, state) {
    const error = new Error(message);
    if (typeof state === "string") error.state = state;
    return error;
  }

  async function invokeRecoveryFunction(functionName, body) {
    const { data, error } = await getClient().functions.invoke(functionName, { body });
    if (error) {
      let responseData = null;
      if (error?.context instanceof Response) {
        try {
          responseData = await error.context.clone().json();
        } catch {
          responseData = null;
        }
      }
      throw recoveryError(
        await getFunctionErrorMessage(error, functionName),
        responseData?.state,
      );
    }
    return data;
  }

  async function beginNativeRecovery() {
    const data = await invokeRecoveryFunction("begin-native-recovery", {});
    if (data?.started !== true || typeof data.transactionToken !== "string" ||
      typeof data.expiresAt !== "string") {
      throw recoveryError(data?.error || "Could not start authenticator recovery.", data?.state);
    }
    return data;
  }

  async function recordNativeRecoveryAttempt(transactionToken) {
    const data = await invokeRecoveryFunction("record-native-recovery-attempt", {
      transactionToken,
    });
    if (data?.allowed !== true) {
      throw recoveryError(data?.error || "Too many recovery attempts. Try again later.", data?.state);
    }
    return data;
  }

  async function completeNativeRecovery(transactionToken, replacementFactorId) {
    const data = await invokeRecoveryFunction("complete-native-recovery", {
      transactionToken,
      replacementFactorId,
    });
    if (data?.completed !== true) {
      throw recoveryError(data?.error || "Could not complete authenticator recovery.", data?.state);
    }
    return data;
  }

  async function cancelNativeRecovery(transactionToken) {
    const data = await invokeRecoveryFunction("cancel-native-recovery", {
      transactionToken,
    });
    if (data?.cancelled !== true) {
      throw recoveryError(data?.error || "Could not cancel authenticator recovery.", data?.state);
    }
    return data;
  }

  async function authorizeNativeRecoveryCodeManagement(regenerate) {
    const data = await invokeRecoveryFunction("authorize-native-recovery-codes", {
      action: regenerate ? "regenerate" : "generate",
    });
    if (data?.allowed !== true) {
      throw recoveryError(data?.error || "Could not manage native recovery codes.", data?.state);
    }
    return data;
  }

  async function getTotpFactors(client = getClient()) {
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) throw error;
    return (data?.all || data?.totp || []).filter(
      (factor) => factor.factor_type === "totp",
    );
  }

  async function getVerifiedTotpFactors(client = getClient()) {
    return (await getTotpFactors(client)).filter((factor) => factor.status === "verified");
  }

  async function getMfaState(client = getClient()) {
    const [{ data: assurance, error: assuranceError }, factors] = await Promise.all([
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
      getVerifiedTotpFactors(client),
    ]);
    if (assuranceError) throw assuranceError;
    return { assurance, factors };
  }

  async function needsChallenge(client = getClient()) {
    const { assurance, factors } = await getMfaState(client);
    return factors.length > 0 &&
      assurance?.currentLevel !== "aal2";
  }

  async function requireRole(role, client = getClient()) {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    const user = userData?.user;
    if (!user) {
      window.location.replace(LOGIN_URL.href);
      return false;
    }

    if (await needsChallenge(client)) {
      window.location.replace(VERIFY_URL.href);
      return false;
    }

    const table = role === "teacher" ? "teachers" : "students";
    const { data: profile, error } = await client
      .from(table)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;

    if (!profile) {
      const { data: otherRole, error: otherRoleError } = await client
        .from(role === "teacher" ? "students" : "teachers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (otherRoleError) throw otherRoleError;
      if (otherRole) {
        window.location.replace(
          role === "teacher" ? STUDENT_DASHBOARD.href : TEACHER_DASHBOARD.href,
        );
        return false;
      }
      window.location.replace(LOGIN_URL.href);
      return false;
    }
    return true;
  }

  async function resolveDashboard(client = getClient()) {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    const user = userData?.user;
    if (!user) throw new Error("Your session has expired. Please sign in again.");

    const { data: teacher, error: teacherError } = await client
      .from("teachers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (teacherError) throw teacherError;
    if (teacher) return TEACHER_DASHBOARD.href;

    const { data: student, error: studentError } = await client
      .from("students")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (studentError) throw studentError;
    if (student) return STUDENT_DASHBOARD.href;
    throw new Error("No teacher or student account is linked to this sign-in.");
  }

  window.SmartLearningMFA = Object.freeze({
    getClient,
    getFunctionErrorMessage,
    beginNativeRecovery,
    recordNativeRecoveryAttempt,
    completeNativeRecovery,
    cancelNativeRecovery,
    authorizeNativeRecoveryCodeManagement,
    getTotpFactors,
    getVerifiedTotpFactors,
    getMfaState,
    needsChallenge,
    requireRole,
    resolveDashboard,
  });
})();
