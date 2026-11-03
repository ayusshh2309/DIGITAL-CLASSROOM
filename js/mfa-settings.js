(() => {
  const mount = document.getElementById("mfaSettingsMount");
  if (!mount) return;

  mount.innerHTML = `
    <section class="mfa-settings-card" aria-labelledby="mfaSettingsTitle">
      <div class="mfa-settings-heading">
        <div class="mfa-settings-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 2 4.5 5v6.2c0 5 3.2 9.5 7.5 10.8 4.3-1.3 7.5-5.8 7.5-10.8V5L12 2Zm0 3.2 4.5 1.8v4.2c0 3.4-1.9 6.7-4.5 8-2.6-1.3-4.5-4.6-4.5-8V7l4.5-1.8Zm-.8 3.3v4.1h1.6V8.5h-1.6Zm0 5.2v1.7h1.6v-1.7h-1.6Z"/></svg>
        </div>
        <div>
          <h3 id="mfaSettingsTitle">Two-Factor Authentication</h3>
          <p>Add an authenticator-app code as an extra layer of sign-in security.</p>
        </div>
      </div>
      <div class="mfa-status-row">
        <span class="mfa-status-pill" id="mfaStatus">Checking status…</span>
        <span class="mfa-device-summary" id="mfaDeviceSummary"></span>
      </div>
      <div class="mfa-factor-list" id="mfaFactorList"></div>
      <p class="mfa-message" id="mfaMessage" role="status" aria-live="polite"></p>
      <div class="mfa-enrollment" id="mfaEnrollment" hidden>
        <h4>Set up your authenticator app</h4>
        <p>Scan this QR code with Google Authenticator, Microsoft Authenticator, or another TOTP app. You can also enter the setup key manually.</p>
        <img class="mfa-qr" id="mfaQrCode" alt="Authenticator setup QR code" />
        <label class="mfa-setup-key">Manual setup key
          <input id="mfaSetupKey" type="text" readonly autocomplete="off" />
        </label>
        <form id="mfaEnrollForm">
          <label class="mfa-code-label" for="mfaEnrollCode">Enter the 6-digit code from your app</label>
          <input id="mfaEnrollCode" class="mfa-code-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required />
          <div class="mfa-actions">
            <button type="submit" class="mfa-primary-button">Verify and Enable</button>
            <button type="button" class="mfa-secondary-button" id="mfaCancelEnrollment">Cancel</button>
          </div>
        </form>
      </div>
      <button type="button" class="mfa-primary-button" id="mfaAddFactor" hidden>Enable Two-Factor Authentication</button>
      <p class="mfa-recovery-note">Supabase does not provide recovery codes. Consider adding a second authenticator device and keep your authenticator app available.</p>
    </section>
  `;

  const status = mount.querySelector("#mfaStatus");
  const summary = mount.querySelector("#mfaDeviceSummary");
  const list = mount.querySelector("#mfaFactorList");
  const message = mount.querySelector("#mfaMessage");
  const enrollment = mount.querySelector("#mfaEnrollment");
  const addButton = mount.querySelector("#mfaAddFactor");
  const codeInput = mount.querySelector("#mfaEnrollCode");
  let pendingFactorId = null;
  let busy = false;

  function setMessage(text, kind = "") {
    message.textContent = text;
    message.dataset.kind = kind;
  }

  function setBusy(value) {
    busy = value;
    mount.querySelectorAll("button, input").forEach((control) => {
      if (control !== mount.querySelector("#mfaSetupKey")) control.disabled = value;
    });
  }

  function clearEnrollment() {
    pendingFactorId = null;
    enrollment.hidden = true;
    mount.querySelector("#mfaQrCode").removeAttribute("src");
    mount.querySelector("#mfaSetupKey").value = "";
    codeInput.value = "";
  }

  async function refresh() {
    const client = window.SmartLearningMFA?.getClient();
    if (!client) throw new Error("Supabase is not configured.");
    const factors = await window.SmartLearningMFA.getTotpFactors(client);
    const verifiedFactors = factors.filter((factor) => factor.status === "verified");
    status.textContent = verifiedFactors.length ? "Enabled" : "Disabled";
    status.dataset.enabled = String(verifiedFactors.length > 0);
    summary.textContent = verifiedFactors.length
      ? `${verifiedFactors.length} verified authenticator${verifiedFactors.length === 1 ? "" : "s"}`
      : "No verified authenticator";
    list.replaceChildren();
    factors.forEach((factor) => {
      const row = document.createElement("div");
      row.className = "mfa-factor-row";
      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = factor.friendly_name || "Authenticator app";
      const created = document.createElement("span");
      created.textContent = factor.status !== "verified"
        ? "Verification pending"
        : factor.created_at
        ? `Added ${new Date(factor.created_at).toLocaleDateString()}`
        : "Verified authenticator";
      details.append(name, created);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "mfa-secondary-button";
      remove.textContent = factor.status === "verified" ? "Disable" : "Remove";
      remove.addEventListener("click", () => {
        if (factor.status === "verified") void disableFactor(factor);
        else void removeUnverifiedFactor(factor);
      });
      row.append(details, remove);
      list.append(row);
    });
    addButton.hidden = false;
    addButton.textContent = verifiedFactors.length
      ? "Add another authenticator"
      : "Enable Two-Factor Authentication";
  }

  async function beginEnrollment() {
    if (busy) return;
    setMessage("");
    setBusy(true);
    try {
      const client = window.SmartLearningMFA.getClient();
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (!userData?.user) throw new Error("Please sign in again before enabling 2FA.");
      const { data, error } = await client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator app",
      });
      if (error) throw error;
      pendingFactorId = data.id;
      mount.querySelector("#mfaQrCode").src = data.totp.qr_code;
      mount.querySelector("#mfaSetupKey").value = data.totp.secret;
      enrollment.hidden = false;
      codeInput.focus();
    } catch (error) {
      setMessage(error.message || "Could not start authenticator setup.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEnrollment(event) {
    event.preventDefault();
    if (busy || !pendingFactorId) return;
    const code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
      setMessage("Enter the 6-digit code from your authenticator app.", "error");
      return;
    }
    setBusy(true);
    setMessage("Verifying your authenticator code…");
    try {
      const client = window.SmartLearningMFA.getClient();
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
        factorId: pendingFactorId,
      });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await client.auth.mfa.verify({
        factorId: pendingFactorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) throw verifyError;
      const verifiedFactors = await window.SmartLearningMFA.getVerifiedTotpFactors(client);
      if (!verifiedFactors.some((factor) => factor.id === pendingFactorId)) {
        throw new Error("The authenticator was not marked verified. Please retry setup.");
      }
      clearEnrollment();
      setMessage("Two-factor authentication is enabled.", "success");
      await refresh();
    } catch (error) {
      setMessage(error.message || "The code could not be verified. Check it and try again.", "error");
    } finally {
      setBusy(false);
      codeInput.value = "";
    }
  }

  async function disableFactor(factor) {
    if (busy) return;
    const code = window.prompt("Enter the current 6-digit code from this authenticator app to disable it.");
    if (code === null) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setMessage("Enter a valid 6-digit authenticator code.", "error");
      return;
    }
    setBusy(true);
    setMessage("Verifying your code…");
    try {
      const client = window.SmartLearningMFA.getClient();
      const { data: assurance, error: assuranceError } =
        await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance?.currentLevel !== "aal2") {
        throw new Error("Sign in again and complete two-factor verification before disabling an authenticator.");
      }
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await client.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;
      const { error: unenrollError } = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (unenrollError) throw unenrollError;
      await refresh();
      setMessage("Authenticator disabled.", "success");
    } catch (error) {
      setMessage(error.message || "Could not disable the authenticator.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeUnverifiedFactor(factor) {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await window.SmartLearningMFA
        .getClient()
        .auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw error;
      await refresh();
      setMessage("Unverified authenticator removed.", "success");
    } catch (error) {
      setMessage(error.message || "Could not remove the unverified authenticator.", "error");
    } finally {
      setBusy(false);
    }
  }

  addButton.addEventListener("click", () => void beginEnrollment());
  mount.querySelector("#mfaEnrollForm").addEventListener("submit", verifyEnrollment);
  mount.querySelector("#mfaCancelEnrollment").addEventListener("click", async () => {
    if (!pendingFactorId || busy) {
      clearEnrollment();
      return;
    }
    const factorId = pendingFactorId;
    setBusy(true);
    try {
      const { error } = await window.SmartLearningMFA
        .getClient()
        .auth.mfa.unenroll({ factorId });
      if (error) throw error;
      clearEnrollment();
      setMessage("Authenticator setup canceled.", "success");
    } catch (error) {
      setMessage(error.message || "Could not remove the unfinished authenticator.", "error");
    } finally {
      setBusy(false);
    }
  });
  refresh().catch((error) => {
    status.textContent = "Unavailable";
    setMessage(error.message || "Could not load authenticator status.", "error");
    addButton.hidden = true;
  });
})();
