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
          <p>Use authenticator apps to add extra protection to your sign-in.</p>
        </div>
      </div>
      <div class="mfa-status-row">
        <span class="mfa-status-pill" id="mfaStatus">Checking status…</span>
        <span class="mfa-device-summary" id="mfaDeviceSummary"></span>
      </div>
      <div class="mfa-device-status" aria-label="Authenticator status">
        <div><strong>Primary authenticator</strong><span id="mfaPrimaryStatus">Checking status…</span></div>
        <div><strong>Backup authenticator</strong><span id="mfaBackupStatus">Not set up</span></div>
      </div>
      <div class="mfa-factor-list" id="mfaFactorList"></div>
      <button type="button" class="mfa-danger-button" id="mfaDisableTwoFactor" hidden>
        Disable Two-Factor Authentication
      </button>
      <p class="mfa-message" id="mfaMessage" role="status" aria-live="polite"></p>
      <div class="mfa-enrollment" id="mfaEnrollment" hidden>
        <h4 id="mfaEnrollmentTitle">Set up your authenticator app</h4>
        <p id="mfaEnrollmentInstructions">Use a separate device for your backup authenticator. Keep the setup key private.</p>
        <img class="mfa-qr" id="mfaQrCode" alt="Authenticator setup QR code" />
        <label class="mfa-setup-key">Manual setup key
          <input id="mfaSetupKey" type="text" readonly autocomplete="off" />
        </label>
        <form id="mfaEnrollForm">
          <label class="mfa-code-label" for="mfaEnrollCode">Enter the 6-digit code from this authenticator</label>
          <input id="mfaEnrollCode" class="mfa-code-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required />
          <div class="mfa-actions">
            <button type="submit" class="mfa-primary-button">Verify and Enable</button>
            <button type="button" class="mfa-secondary-button" id="mfaCancelEnrollment">Cancel setup</button>
          </div>
        </form>
      </div>
      <button type="button" class="mfa-primary-button" id="mfaAddFactor" hidden>Set Up Backup Authenticator</button>
      <section class="mfa-recovery-section" aria-labelledby="mfaLostAccessTitle">
        <h4 id="mfaLostAccessTitle">Lost access to all your authenticators?</h4>
        <p>Supabase native recovery codes are not enabled for this hosted Auth project. There is no self-service factor reset. Contact your school administrator or Smart Learning DC support for an independent identity review.</p>
        <p class="mfa-recovery-note">Do not send anyone your password, authenticator code, QR code, or setup key. Support-assisted identity verification is required; a factor will not be removed based only on email or an existing browser session.</p>
      </section>
    </section>
  `;

  const status = mount.querySelector("#mfaStatus");
  const summary = mount.querySelector("#mfaDeviceSummary");
  const primaryStatus = mount.querySelector("#mfaPrimaryStatus");
  const backupStatus = mount.querySelector("#mfaBackupStatus");
  const list = mount.querySelector("#mfaFactorList");
  const disableButton = mount.querySelector("#mfaDisableTwoFactor");
  const message = mount.querySelector("#mfaMessage");
  const enrollment = mount.querySelector("#mfaEnrollment");
  const enrollmentTitle = mount.querySelector("#mfaEnrollmentTitle");
  const enrollmentInstructions = mount.querySelector("#mfaEnrollmentInstructions");
  const addButton = mount.querySelector("#mfaAddFactor");
  const codeInput = mount.querySelector("#mfaEnrollCode");
  const setupKey = mount.querySelector("#mfaSetupKey");
  const qrCode = mount.querySelector("#mfaQrCode");
  let currentUserId = null;
  let pendingFactorId = null;
  let busy = false;

  function setMessage(text, kind = "") {
    message.textContent = text;
    message.dataset.kind = kind;
  }

  function markStatusUnavailable(error) {
    status.textContent = "Unavailable";
    status.dataset.enabled = "false";
    summary.textContent = "";
    primaryStatus.textContent = "Unable to check";
    backupStatus.textContent = "Unable to check";
    list.replaceChildren();
    addButton.hidden = true;
    disableButton.hidden = true;
    disableButton.disabled = true;
    setMessage(error.message || "Could not load authenticator status.", "error");
  }

  function setBusy(value) {
    busy = value;
    mount.querySelectorAll("button, input").forEach((control) => {
      if (control === setupKey) return;
      control.disabled = value || control.dataset.mfaDisabled === "true";
    });
  }

  function clearEnrollment() {
    pendingFactorId = null;
    enrollment.hidden = true;
    qrCode.removeAttribute("src");
    qrCode.hidden = true;
    setupKey.value = "";
    codeInput.value = "";
  }

  function getQrImageSource(qrCodeValue) {
    if (typeof qrCodeValue !== "string" || !qrCodeValue.trim()) return null;
    const value = qrCodeValue.trim();
    if (/^data:image\/svg\+xml(?:;[^,]*)?,/i.test(value)) return value;
    if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(value) && /<\/svg>\s*$/i.test(value)) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
    }
    return null;
  }

  async function requireCurrentUser(client) {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data?.user || data.user.id !== currentUserId) {
      throw new Error("Your signed-in account changed. Reload Security settings and try again.");
    }
    return data.user;
  }

  async function withFactorMutationLock(client, action, required = true) {
    const user = await requireCurrentUser(client);
    const locks = window.navigator?.locks;
    if (!locks?.request) {
      if (!required) {
        await requireCurrentUser(client);
        return action(user.id);
      }
      throw new Error("This browser cannot coordinate authenticator changes across tabs. Use a current browser over HTTPS.");
    }

    // Web Locks coordinate this UI across same-origin tabs, not direct Auth API calls or other devices.
    let acquired = false;
    const result = await locks.request(
      `smart-learning-mfa-factor-mutation:${user.id}`,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) return undefined;
        acquired = true;
        await requireCurrentUser(client);
        return action(user.id);
      },
    );
    if (!acquired) {
      throw new Error("An authenticator change is already in progress in another tab. Wait for it to finish, then retry.");
    }
    return result;
  }

  async function refresh() {
    const client = window.SmartLearningMFA?.getClient();
    if (!client) throw new Error("Supabase is not configured.");
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!userData?.user) throw new Error("Please sign in again.");
    currentUserId = userData.user.id;

    const factors = await window.SmartLearningMFA.getTotpFactors(client);
    if (pendingFactorId && !factors.some((factor) =>
      factor.id === pendingFactorId && factor.status === "unverified"
    )) {
      clearEnrollment();
    }

    const verifiedFactors = factors
      .filter((factor) => factor.status === "verified")
      .sort((left, right) => {
        const leftTime = Date.parse(left.created_at || "");
        const rightTime = Date.parse(right.created_at || "");
        return (Number.isFinite(leftTime) ? leftTime : 0) -
          (Number.isFinite(rightTime) ? rightTime : 0);
      });
    const unverifiedFactors = factors.filter((factor) => factor.status !== "verified");
    const primaryFactor = verifiedFactors[0];
    const backupFactors = verifiedFactors.slice(1);

    status.textContent = verifiedFactors.length ? "Enabled" : "Not enabled";
    status.dataset.enabled = String(verifiedFactors.length > 0);
    summary.textContent = verifiedFactors.length
      ? `${verifiedFactors.length} verified authenticator${verifiedFactors.length === 1 ? "" : "s"}`
      : "No verified authenticator";
    primaryStatus.textContent = primaryFactor
      ? "Active"
      : unverifiedFactors.length ? "Verification pending" : "Not set up";
    backupStatus.textContent = backupFactors.length
      ? `${backupFactors.length} verified`
      : verifiedFactors.length && unverifiedFactors.length
        ? "Verification pending"
        : "Not set up";
    disableButton.hidden = verifiedFactors.length === 0;
    disableButton.disabled = busy || verifiedFactors.length === 0;

    list.replaceChildren();
    factors.forEach((factor) => {
      const row = document.createElement("div");
      row.className = "mfa-factor-row";
      const details = document.createElement("div");
      const role = factor.status === "verified"
        ? factor.id === primaryFactor?.id ? "Primary authenticator" : "Backup authenticator"
        : verifiedFactors.length ? "Backup authenticator - verification pending" : "Primary authenticator - verification pending";
      const name = document.createElement("strong");
      name.textContent = factor.friendly_name || role;
      const detail = document.createElement("span");
      detail.textContent = factor.status === "verified"
        ? `${role}${factor.created_at ? ` - Added ${new Date(factor.created_at).toLocaleDateString()}` : ""}`
        : role;
      details.append(name, detail);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "mfa-secondary-button";
      remove.textContent = factor.status === "verified" ? "Remove" : "Remove setup";
      const cannotRemoveLastFactor = factor.status === "verified" && verifiedFactors.length <= 1;
      remove.dataset.mfaDisabled = String(cannotRemoveLastFactor);
      remove.disabled = busy || cannotRemoveLastFactor;
      if (cannotRemoveLastFactor) {
        remove.title = "Set up and verify another authenticator before removing this one.";
      }
      remove.addEventListener("click", () => {
        if (factor.status === "verified") void removeVerifiedFactor(factor);
        else void removeUnverifiedFactor(factor);
      });
      row.append(details, remove);
      list.append(row);
    });

    const pendingSetup = unverifiedFactors.length > 0;
    addButton.hidden = false;
    addButton.textContent = verifiedFactors.length
      ? "Set Up Backup Authenticator"
      : "Set Up Primary Authenticator";
    addButton.dataset.mfaDisabled = String(pendingSetup);
    addButton.disabled = busy || pendingSetup;
    addButton.title = pendingSetup
      ? "Verify or remove the pending authenticator setup before starting another."
      : "";
    return verifiedFactors.length;
  }

  async function beginEnrollment() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    let client;
    let createdFactorId = null;
    try {
      client = window.SmartLearningMFA.getClient();
      const { data, verifiedFactorCount } = await withFactorMutationLock(client, async () => {
        const factors = await window.SmartLearningMFA.getTotpFactors(client);
        const verifiedFactors = factors.filter((factor) => factor.status === "verified");
        if (factors.some((factor) => factor.status !== "verified")) {
          throw new Error("Finish or remove the pending authenticator setup before adding another.");
        }

        if (verifiedFactors.length) {
          const { data: assurance, error: assuranceError } =
            await client.auth.mfa.getAuthenticatorAssuranceLevel();
          if (assuranceError) throw assuranceError;
          if (assurance?.currentLevel !== "aal2") {
            throw new Error("Verify an existing authenticator to AAL2 before setting up a backup.");
          }
        }

        const factorName = verifiedFactors.length ? "Backup authenticator" : "Primary authenticator";
        const { data, error } = await client.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: factorName,
        });
        if (error) throw error;
        return { data, verifiedFactorCount: verifiedFactors.length };
      }, false);
      createdFactorId = typeof data?.id === "string" ? data.id : null;
      pendingFactorId = createdFactorId;
      await requireCurrentUser(client);
      if (!createdFactorId || typeof data?.totp?.secret !== "string" ||
        !data.totp.secret.trim()) {
        throw new Error("Supabase returned incomplete authenticator setup details.");
      }

      const qrImageSource = getQrImageSource(data.totp.qr_code);
      enrollmentTitle.textContent = verifiedFactorCount
        ? "Set up your backup authenticator"
        : "Set up your primary authenticator";
      enrollmentInstructions.textContent = verifiedFactorCount
        ? "Scan this QR code or enter the setup key on a separate device. Keep the key private and verify a code from that device."
        : "Scan this QR code or enter the setup key in your authenticator app, then verify a code.";
      qrCode.hidden = !qrImageSource;
      if (qrImageSource) qrCode.src = qrImageSource;
      else qrCode.removeAttribute("src");
      setupKey.value = data.totp.secret;
      enrollment.hidden = false;
      addButton.dataset.mfaDisabled = "true";
      addButton.disabled = true;
      setMessage(qrImageSource
        ? "The setup key is shown only during enrollment. Do not share it or store it in an unprotected place."
        : "A QR code is unavailable. Use the manual setup key, which is shown only during enrollment; do not share or store it in an unprotected place.");
      codeInput.focus();
    } catch (error) {
      let cleanupMessage = "";
      if (client && createdFactorId) {
        try {
          await withFactorMutationLock(client, async () => {
            const factors = await window.SmartLearningMFA.getTotpFactors(client);
            const createdFactor = factors.find((factor) => factor.id === createdFactorId);
            if (createdFactor?.status === "unverified") {
              await requireCurrentUser(client);
              const { error: cleanupError } = await client.auth.mfa.unenroll({
                factorId: createdFactorId,
              });
              if (cleanupError) throw cleanupError;
            }
          });
        } catch (cleanupError) {
          console.error("Could not remove the incomplete authenticator setup.", cleanupError);
          cleanupMessage = " The incomplete setup may remain in the factor list; remove it there before retrying.";
        }
      }
      clearEnrollment();
      try {
        await refresh();
      } catch (refreshError) {
        console.error("Could not refresh authenticator status after setup failed.", refreshError);
        cleanupMessage += " Reload Security settings to check the current factor status.";
      }
      setMessage(`${error.message || "Could not start authenticator setup."}${cleanupMessage}`, "error");
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
      const factorId = pendingFactorId;
      await withFactorMutationLock(client, async () => {
        const factors = await window.SmartLearningMFA.getTotpFactors(client);
        if (!factors.some((factor) => factor.id === factorId && factor.status === "unverified")) {
          throw new Error("This authenticator setup is no longer pending. Refresh the page and try again.");
        }
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

        await requireCurrentUser(client);
        const verifiedFactors = await window.SmartLearningMFA.getVerifiedTotpFactors(client);
        if (!verifiedFactors.some((factor) => factor.id === factorId)) {
          throw new Error("Supabase did not mark this authenticator as verified. Try again.");
        }
      }, false);
      clearEnrollment();
      await refresh();
      const { data: assurance, error: assuranceError } =
        await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance?.currentLevel !== "aal2") {
        setMessage("The authenticator is verified, but this session did not reach AAL2. Sign in again to refresh your session.", "error");
        return;
      }
      setMessage("Authenticator verified and enabled.", "success");
    } catch (error) {
      setMessage(error.message || "The code could not be verified. Check it and try again.", "error");
    } finally {
      codeInput.value = "";
      setBusy(false);
    }
  }

  async function removeVerifiedFactor(factor) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    let result = null;
    let operationError = null;
    let refreshError = null;
    try {
      const client = window.SmartLearningMFA.getClient();
      result = await withFactorMutationLock(client, async () => {
        const currentFactors = await window.SmartLearningMFA.getVerifiedTotpFactors(client);
        if (!currentFactors.some((item) => item.id === factor.id)) {
          throw new Error("This authenticator is no longer verified. Refresh the page and try again.");
        }
        if (!currentFactors.some((item) => item.id !== factor.id)) {
          throw new Error("Set up and verify another authenticator before removing this one.");
        }
        if (!window.confirm(
          "Removing this authenticator may invalidate existing sessions. Confirm that another verified authenticator is available before continuing.",
        )) return "cancelled";
        const code = window.prompt("Enter the current 6-digit code from the authenticator you are removing.");
        if (code === null) return "cancelled";
        if (!/^\d{6}$/.test(code.trim())) {
          throw new Error("Enter a valid 6-digit authenticator code.");
        }
        await requireCurrentUser(client);
        setMessage("Verifying the authenticator before removal…");
        const { data: assurance, error: assuranceError } =
          await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assuranceError) throw assuranceError;
        if (assurance?.currentLevel !== "aal2") {
          throw new Error("Sign in again and complete two-factor verification before removing an authenticator.");
        }
        const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
          factorId: factor.id,
        });
        if (challengeError) throw challengeError;
        if (!challenge?.id) throw new Error("Supabase did not return a verification challenge. Try again.");
        const { error: verifyError } = await client.auth.mfa.verify({
          factorId: factor.id,
          challengeId: challenge.id,
          code: code.trim(),
        });
        if (verifyError) throw verifyError;

        await requireCurrentUser(client);
        const { data: verifiedAssurance, error: verifiedAssuranceError } =
          await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (verifiedAssuranceError) throw verifiedAssuranceError;
        if (verifiedAssurance?.currentLevel !== "aal2") {
          throw new Error("The authenticator was verified, but this session did not reach AAL2. No authenticator was removed.");
        }
        const latestFactors = await window.SmartLearningMFA.getVerifiedTotpFactors(client);
        if (!latestFactors.some((item) => item.id === factor.id) ||
          !latestFactors.some((item) => item.id !== factor.id)) {
          throw new Error("Another verified authenticator is required. No authenticator was removed.");
        }
        await requireCurrentUser(client);
        const { error: unenrollError } = await client.auth.mfa.unenroll({ factorId: factor.id });
        if (unenrollError) throw unenrollError;
        return "removed";
      });
    } catch (error) {
      operationError = error;
    } finally {
      try {
        await refresh();
      } catch (error) {
        refreshError = error;
        markStatusUnavailable(error);
      }
      setBusy(false);
    }
    if (operationError) {
      const refreshNotice = refreshError
        ? " Current authenticator status could not be refreshed; reload Security settings."
        : "";
      setMessage(`${operationError.message || "Could not remove the authenticator."}${refreshNotice}`, "error");
    } else if (result === "removed") {
      setMessage(refreshError
        ? "Authenticator removal succeeded, but the remaining status could not be refreshed. Sign in again and reload Security settings."
        : "Authenticator removed. Another verified authenticator remains enrolled.", refreshError ? "error" : "success");
    } else if (refreshError) {
      setMessage("Authenticator status could not be refreshed. Reload Security settings.", "error");
    }
  }

  async function disableTwoFactor() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    let result = null;
    let operationError = null;
    let refreshError = null;
    let removedCount = 0;
    let totalCount = 0;
    let remainingCount = null;
    try {
      const client = window.SmartLearningMFA.getClient();
      result = await withFactorMutationLock(client, async () => {
        const { data: assurance, error: assuranceError } =
          await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assuranceError) throw assuranceError;
        if (assurance?.currentLevel !== "aal2") {
          throw new Error("Complete two-factor verification to AAL2 before disabling it.");
        }

        const factors = await window.SmartLearningMFA.getTotpFactors(client);
        if (factors.some((factor) => factor.status !== "verified")) {
          throw new Error("Finish or cancel the pending authenticator setup before disabling two-factor authentication.");
        }
        const verifiedFactors = factors.filter((factor) => factor.status === "verified");
        if (!verifiedFactors.length) {
          throw new Error("No verified authenticator is currently enrolled.");
        }
        if (!window.confirm(
          `Disable two-factor authentication and remove all ${verifiedFactors.length} verified authenticator${verifiedFactors.length === 1 ? "" : "s"}? This may invalidate existing sessions.`,
        )) return "cancelled";

        const code = window.prompt("Enter a current 6-digit code from one of your verified authenticators.");
        if (code === null) return "cancelled";
        if (!/^\d{6}$/.test(code.trim())) {
          throw new Error("Enter a valid 6-digit authenticator code.");
        }

        await requireCurrentUser(client);
        const { data: currentAssurance, error: currentAssuranceError } =
          await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (currentAssuranceError) throw currentAssuranceError;
        if (currentAssurance?.currentLevel !== "aal2") {
          throw new Error("Your session is no longer at AAL2. Sign in again before disabling two-factor authentication.");
        }
        const currentVerifiedFactors = await window.SmartLearningMFA.getVerifiedTotpFactors(client);
        if (!currentVerifiedFactors.length) {
          throw new Error("No verified authenticator remains to disable.");
        }
        setMessage("Verifying your current authenticator code…");
        const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
          factorId: currentVerifiedFactors[0].id,
        });
        if (challengeError) throw challengeError;
        if (!challenge?.id) throw new Error("Supabase did not return a verification challenge. Try again.");
        const { error: verifyError } = await client.auth.mfa.verify({
          factorId: currentVerifiedFactors[0].id,
          challengeId: challenge.id,
          code: code.trim(),
        });
        if (verifyError) throw verifyError;

        await requireCurrentUser(client);
        const { data: verifiedAssurance, error: verifiedAssuranceError } =
          await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (verifiedAssuranceError) throw verifiedAssuranceError;
        if (verifiedAssurance?.currentLevel !== "aal2") {
          throw new Error("The authenticator code was accepted, but this session did not reach AAL2. No factors were removed.");
        }

        const factorsToRemove = await window.SmartLearningMFA.getVerifiedTotpFactors(client);
        if (!factorsToRemove.length) {
          throw new Error("No verified authenticator remains to disable.");
        }
        totalCount = factorsToRemove.length;
        setMessage("Removing verified authenticators…");
        for (const factor of factorsToRemove) {
          await requireCurrentUser(client);
          const currentFactors = await window.SmartLearningMFA.getVerifiedTotpFactors(client);
          if (!currentFactors.some((item) => item.id === factor.id)) continue;
          await requireCurrentUser(client);
          const { error: unenrollError } = await client.auth.mfa.unenroll({
            factorId: factor.id,
          });
          if (unenrollError) {
            throw new Error(`Could not remove all authenticators after ${removedCount} of ${totalCount} were removed. ${unenrollError.message}`);
          }
          removedCount += 1;
        }
        return "disabled";
      });
    } catch (error) {
      operationError = error;
    } finally {
      try {
        remainingCount = await refresh();
      } catch (error) {
        refreshError = error;
        markStatusUnavailable(error);
      }
      setBusy(false);
    }

    if (operationError) {
      const partialMessage = removedCount
        ? `Removed ${removedCount} of ${totalCount} verified authenticators before the failure.`
        : "";
      const remainingMessage = Number.isInteger(remainingCount)
        ? ` ${remainingCount} verified authenticator${remainingCount === 1 ? "" : "s"} remain.`
        : "";
      const refreshNotice = refreshError
        ? " The remaining status could not be refreshed; sign in again and reload Security settings."
        : "";
      setMessage(`${partialMessage} ${operationError.message || "Could not disable two-factor authentication."}${remainingMessage}${refreshNotice}`, "error");
    } else if (result === "disabled") {
      if (refreshError) {
        setMessage(`Removed ${removedCount} verified authenticator${removedCount === 1 ? "" : "s"}, but the final status could not be refreshed. Sign in again and reload Security settings.`, "error");
      } else if (remainingCount > 0) {
        setMessage(`Removed ${removedCount} verified authenticator${removedCount === 1 ? "" : "s"}; ${remainingCount} verified factor${remainingCount === 1 ? "" : "s"} remain. Review the refreshed status and retry if needed.`, "error");
      } else {
        setMessage("Two-factor authentication is disabled. No verified authenticator remains enrolled.", "success");
      }
    } else if (refreshError) {
      setMessage("Authenticator status could not be refreshed. Reload Security settings.", "error");
    }
  }

  async function removeUnverifiedFactor(factor) {
    if (busy || !window.confirm("Remove this unfinished authenticator setup?")) return;
    setBusy(true);
    try {
      const client = window.SmartLearningMFA.getClient();
      await withFactorMutationLock(client, async () => {
        const factors = await window.SmartLearningMFA.getTotpFactors(client);
        const currentFactor = factors.find((item) => item.id === factor.id);
        if (currentFactor?.status === "verified") {
          throw new Error("This authenticator is now verified. Refresh the page before removing it.");
        }
        if (currentFactor) {
          await requireCurrentUser(client);
          const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
          if (error) throw error;
        }
      });
      if (pendingFactorId === factor.id) clearEnrollment();
      await refresh();
      setMessage("Unverified authenticator setup removed.", "success");
    } catch (error) {
      setMessage(error.message || "Could not remove the unfinished authenticator.", "error");
    } finally {
      setBusy(false);
    }
  }

  addButton.addEventListener("click", () => void beginEnrollment());
  disableButton.addEventListener("click", () => void disableTwoFactor());
  mount.querySelector("#mfaEnrollForm").addEventListener("submit", verifyEnrollment);
  mount.querySelector("#mfaCancelEnrollment").addEventListener("click", async () => {
    if (busy || !pendingFactorId) {
      if (!busy) clearEnrollment();
      return;
    }
    if (!window.confirm("Cancel setup and remove this unverified authenticator?")) return;
    const factorId = pendingFactorId;
    setBusy(true);
    try {
      const client = window.SmartLearningMFA.getClient();
      await withFactorMutationLock(client, async () => {
        const factors = await window.SmartLearningMFA.getTotpFactors(client);
        const factor = factors.find((item) => item.id === factorId);
        if (factor?.status === "verified") {
          throw new Error("This authenticator is already verified and was not removed.");
        }
        if (factor) {
          await requireCurrentUser(client);
          const { error } = await client.auth.mfa.unenroll({ factorId });
          if (error) throw error;
        }
      });
      clearEnrollment();
      await refresh();
      setMessage("Authenticator setup canceled.", "success");
    } catch (error) {
      clearEnrollment();
      try {
        await refresh();
      } catch (refreshError) {
        console.error("Could not refresh authenticator status after setup cancellation failed.", refreshError);
      }
      setMessage(`${error.message || "Could not remove the unfinished authenticator."} Check the factor list and retry if it remains.`, "error");
    } finally {
      setBusy(false);
    }
  });
  qrCode.addEventListener("error", () => {
    if (!enrollment.hidden) {
      qrCode.hidden = true;
      setMessage("The QR image could not be displayed. Use the manual setup key instead.", "error");
    }
  });

  refresh().catch((error) => {
    markStatusUnavailable(error);
  });
})();
