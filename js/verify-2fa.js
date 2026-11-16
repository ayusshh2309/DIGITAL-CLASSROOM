(() => {
  "use strict";

  const client = window.SmartLearningMFA.getClient();
  const form = document.getElementById("verifyForm");
  const codeInput = document.getElementById("verificationCode");
  const button = document.getElementById("verifyButton");
  const buttonText = document.getElementById("buttonText");
  const status = document.getElementById("status");
  const authenticatorChoice = document.getElementById("authenticatorChoice");
  const authenticatorLabel = document.getElementById("authenticatorLabel");
  const lostAccessButton = document.getElementById("lostAccessButton");
  const lostAccessHelp = document.getElementById("lostAccessHelp");
  let factorId = null;
  let authenticatedUserId = null;
  let busy = false;
  let accountChanged = false;
  let authStateSubscription = null;

  function showStatus(text, kind = "") {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function setBusy(value) {
    busy = value;
    button.disabled = value || accountChanged;
    codeInput.disabled = value || accountChanged;
    authenticatorChoice.disabled = value || accountChanged;
    button.setAttribute("aria-busy", String(value));
    buttonText.textContent = value ? "Verifying..." : "Verify and continue";
  }

  async function requireCurrentUser() {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data?.user || data.user.id !== authenticatedUserId) {
      accountChanged = true;
      throw new Error("The signed-in account changed. Sign in again to continue.");
    }
    return data.user;
  }

  lostAccessButton.addEventListener("click", () => {
    lostAccessHelp.hidden = !lostAccessHelp.hidden;
    lostAccessButton.setAttribute("aria-expanded", String(!lostAccessHelp.hidden));
  });

  async function initialize() {
    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (!userData?.user) {
        window.location.replace("teacher_registration/login.html");
        return;
      }
      authenticatedUserId = userData.user.id;

      const { data: authState, error: assuranceError } =
        await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      const factors = await window.SmartLearningMFA.getVerifiedTotpFactors(client);
      lostAccessButton.hidden = false;

      if (!factors.length) {
        form.hidden = true;
        lostAccessHelp.hidden = false;
        lostAccessButton.setAttribute("aria-expanded", "true");
        showStatus("No verified authenticator is available for this account.", "error");
        return;
      }

      if (authState?.currentLevel === "aal2") {
        window.location.replace(await window.SmartLearningMFA.resolveDashboard(client));
        return;
      }
      if (authState?.nextLevel !== "aal2") {
        throw new Error("This sign-in session cannot complete two-factor verification. Sign in again.");
      }

      factors.forEach((factor, index) => {
        const option = document.createElement("option");
        option.value = factor.id;
        option.textContent = factor.friendly_name || `Authenticator ${index + 1}`;
        authenticatorChoice.append(option);
      });
      factorId = factors[0].id;
      if (factors.length > 1) {
        authenticatorChoice.hidden = false;
        authenticatorLabel.hidden = false;
        authenticatorChoice.addEventListener("change", () => {
          factorId = authenticatorChoice.value;
        });
      }

      const { data: authSubscription } = client.auth.onAuthStateChange((_event, session) => {
        if (!session?.user || session.user.id !== authenticatedUserId) {
          accountChanged = true;
          setBusy(false);
          showStatus("The signed-in account changed. Sign in again to continue.", "error");
        }
      });
      authStateSubscription = authSubscription.subscription;
      codeInput.focus();
    } catch (error) {
      showStatus(error.message || "Unable to check your sign-in. Please try again.", "error");
      form.hidden = true;
      lostAccessButton.hidden = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || accountChanged) return;
    const code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
      showStatus("Enter the 6-digit code from your authenticator app.", "error");
      return;
    }
    setBusy(true);
    showStatus("Verifying your code...");
    try {
      await requireCurrentUser();
      if (!factorId) throw new Error("No verified authenticator is available for this account.");
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
        factorId,
      });
      if (challengeError) throw challengeError;
      if (!challenge?.id) throw new Error("Supabase did not return a verification challenge. Try again.");
      const { error: verifyError } = await client.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) throw verifyError;

      await requireCurrentUser();
      const { data: assurance, error: assuranceError } =
        await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance?.currentLevel !== "aal2") {
        throw new Error("Two-factor verification did not upgrade this session to AAL2.");
      }
      const dashboard = await window.SmartLearningMFA.resolveDashboard(client);
      showStatus("Verification successful. Opening your dashboard...", "success");
      window.location.replace(dashboard);
    } catch (error) {
      showStatus(error.message || "Invalid or expired code. Please try again.", "error");
      codeInput.value = "";
      codeInput.focus();
    } finally {
      setBusy(false);
    }
  });

  window.addEventListener("pagehide", () => {
    authStateSubscription?.unsubscribe();
  }, { once: true });

  void initialize();
})();
