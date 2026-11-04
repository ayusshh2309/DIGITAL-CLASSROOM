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
      <section class="mfa-recovery-section" aria-labelledby="recoveryCodesTitle">
        <h4 id="recoveryCodesTitle">Backup Recovery Codes</h4>
        <p>Generate Supabase recovery codes while your authenticator is available and your session is at AAL2. A native recovery code is consumed as soon as it is verified, even if you later cancel replacement setup.</p>
        <p class="mfa-recovery-note">Older Smart Learning DC backup codes are not Supabase recovery codes and cannot be used for native MFA recovery. Keep your current authenticator enabled until you have safely stored the new codes.</p>
        <p class="mfa-recovery-count" id="recoveryCodeCount" role="status" aria-live="polite">Checking recovery codes…</p>
        <div class="mfa-actions">
          <button type="button" class="mfa-primary-button" id="generateRecoveryCodes" disabled>Generate Recovery Codes</button>
          <button type="button" class="mfa-secondary-button" id="regenerateRecoveryCodes" hidden disabled>Regenerate Codes</button>
        </div>
        <div class="mfa-recovery-display" id="recoveryCodesDisplay" hidden>
          <p>These codes are shown only once. Save or download them now; they cannot be viewed again.</p>
          <ol id="recoveryCodesList"></ol>
          <div class="mfa-actions">
            <button type="button" class="mfa-secondary-button" id="copyRecoveryCodes">Copy all codes</button>
            <button type="button" class="mfa-secondary-button" id="downloadRecoveryCodes">Download codes</button>
          </div>
        </div>
        <p class="mfa-recovery-note">Regenerating native codes immediately invalidates every previous unused native code.</p>
      </section>
    </section>
  `;

  const status = mount.querySelector("#mfaStatus");
  const summary = mount.querySelector("#mfaDeviceSummary");
  const list = mount.querySelector("#mfaFactorList");
  const message = mount.querySelector("#mfaMessage");
  const enrollment = mount.querySelector("#mfaEnrollment");
  const addButton = mount.querySelector("#mfaAddFactor");
  const codeInput = mount.querySelector("#mfaEnrollCode");
  const recoveryCount = mount.querySelector("#recoveryCodeCount");
  const generateRecoveryButton = mount.querySelector("#generateRecoveryCodes");
  const regenerateRecoveryButton = mount.querySelector("#regenerateRecoveryCodes");
  const recoveryDisplay = mount.querySelector("#recoveryCodesDisplay");
  let visibleRecoveryCodes = [];
  let recoveryManagementAllowed = false;
  let recoveryStatusAvailable = false;
  let currentUserId = null;
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
    if (!value) {
      const disabled = !recoveryManagementAllowed || !recoveryStatusAvailable;
      generateRecoveryButton.disabled = disabled;
      regenerateRecoveryButton.disabled = disabled;
    }
  }

  function showRecoveryCodes(codes) {
    visibleRecoveryCodes = codes;
    const codeList = mount.querySelector("#recoveryCodesList");
    codeList.replaceChildren();
    codes.forEach((code) => {
      const item = document.createElement("li");
      item.textContent = code;
      codeList.append(item);
    });
    recoveryDisplay.hidden = false;
  }

  async function loadRecoveryCodeStatus() {
    const client = window.SmartLearningMFA.getClient();
    const { data, error } = await client.auth.mfa.recoveryCodes.getStatus();
    if (error?.code === "mfa_factor_not_found") {
      recoveryStatusAvailable = true;
      recoveryCount.textContent = "No Supabase recovery codes are enrolled.";
      generateRecoveryButton.hidden = false;
      regenerateRecoveryButton.hidden = true;
      generateRecoveryButton.disabled = !recoveryManagementAllowed;
      regenerateRecoveryButton.disabled = true;
      return;
    }
    if (error) throw error;
    if (!data || !Number.isInteger(data.remaining) || !Number.isInteger(data.total)) {
      throw new Error("Supabase returned an invalid recovery-code status.");
    }
    recoveryStatusAvailable = true;
    recoveryCount.textContent = `${data.remaining} unused native recovery code${data.remaining === 1 ? "" : "s"} remaining.`;
    generateRecoveryButton.hidden = true;
    regenerateRecoveryButton.hidden = false;
    const disabled = !recoveryManagementAllowed;
    generateRecoveryButton.disabled = disabled;
    regenerateRecoveryButton.disabled = disabled;
    if (disabled) recoveryCount.textContent += " Verify your authenticator and reach AAL2 to manage codes.";
  }

  async function createRecoveryCodes(regenerate) {
    if (busy) return;
    if (regenerate && !window.confirm(
      "Regenerate backup recovery codes? All previous unused codes will immediately stop working.",
    )) return;
    setBusy(true);
    recoveryDisplay.hidden = true;
    visibleRecoveryCodes = [];
    setMessage(regenerate ? "Regenerating native recovery codes…" : "Generating native recovery codes…");
    try {
      const client = window.SmartLearningMFA.getClient();
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (!userData?.user || userData.user.id !== currentUserId) {
        throw new Error("Your signed-in account changed. Reload settings before managing recovery codes.");
      }
      const { data: assurance, error: assuranceError } =
        await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance?.currentLevel !== "aal2") {
        throw new Error("Verify your existing authenticator to AAL2 before managing native recovery codes.");
      }
      await window.SmartLearningMFA.authorizeNativeRecoveryCodeManagement(regenerate);
      const { data, error } = regenerate
        ? await client.auth.mfa.recoveryCodes.regenerate()
        : await client.auth.mfa.recoveryCodes.generate({ friendlyName: "Smart Learning backup codes" });
      if (error) throw error;
      if (!Array.isArray(data?.codes) || !data.codes.length ||
        data.codes.some((code) => typeof code !== "string")) {
        throw new Error("Supabase returned an invalid native recovery-code response.");
      }
      showRecoveryCodes(data.codes);
      setMessage("Native recovery codes generated. Save them now; they are shown only once and a code is consumed immediately when verified.", "success");
      try {
        await loadRecoveryCodeStatus();
      } catch {
        recoveryStatusAvailable = false;
        recoveryCount.textContent = "Recovery-code status unavailable. The generated codes are still shown above; save them now.";
      }
    } catch (error) {
      setMessage(error.message || "Could not generate recovery codes.", "error");
    } finally {
      setBusy(false);
    }
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
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!userData?.user) throw new Error("Please sign in again.");
    currentUserId = userData.user.id;
    const factors = await window.SmartLearningMFA.getTotpFactors(client);
    const verifiedFactors = factors.filter((factor) => factor.status === "verified");
    const { data: assurance, error: assuranceError } =
      await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    recoveryManagementAllowed = verifiedFactors.length > 0 &&
      assurance?.currentLevel === "aal2";
    const recoveryControlsDisabled = !recoveryManagementAllowed || !recoveryStatusAvailable;
    generateRecoveryButton.disabled = recoveryControlsDisabled;
    regenerateRecoveryButton.disabled = recoveryControlsDisabled;
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
  generateRecoveryButton.addEventListener("click", () => void createRecoveryCodes(false));
  regenerateRecoveryButton.addEventListener("click", () => void createRecoveryCodes(true));
  mount.querySelector("#copyRecoveryCodes").addEventListener("click", async () => {
    if (!visibleRecoveryCodes.length) return;
    try {
      await navigator.clipboard.writeText(visibleRecoveryCodes.join("\n"));
      setMessage("Recovery codes copied to the clipboard.", "success");
    } catch (error) {
      setMessage(error.message || "Could not copy recovery codes. Select and copy them manually.", "error");
    }
  });
  mount.querySelector("#downloadRecoveryCodes").addEventListener("click", () => {
    if (!visibleRecoveryCodes.length) return;
    const blob = new Blob([`${visibleRecoveryCodes.join("\r\n")}\r\n`], { type: "text/plain;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "smart-learning-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(downloadUrl);
    setMessage("Recovery codes downloaded. Keep the file somewhere private.", "success");
  });
  refresh().catch((error) => {
    status.textContent = "Unavailable";
    setMessage(error.message || "Could not load authenticator status.", "error");
    addButton.hidden = true;
  });
  loadRecoveryCodeStatus().catch((error) => {
    recoveryCount.textContent = "Native recovery-code status unavailable.";
    setMessage(error.message || "Could not load recovery-code status.", "error");
    recoveryStatusAvailable = false;
    generateRecoveryButton.disabled = true;
    regenerateRecoveryButton.disabled = true;
  });
})();
