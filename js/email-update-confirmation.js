(() => {
  const button = document.getElementById("confirmEmailButton");
  const status = document.getElementById("confirmationStatus");
  const emailDisplay = document.getElementById("confirmationEmail");
  if (!button || !status || !emailDisplay) return;

  const params = new URLSearchParams(window.location.search);
  let tokenHash = params.get("token_hash");
  const verificationType = params.get("type");
  let actionMode = "confirm";
  let busy = false;

  if (window.location.search || window.location.hash) {
    window.history.replaceState(null, document.title, window.location.pathname);
  }

  const setStatus = (message, state = "") => {
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  };

  const showError = (prefix, error) => {
    setStatus(
      `${prefix}: ${error?.message || "Unknown authentication or database error."}`,
      "error",
    );
  };

  if (
    !window.SmartLearningSupabase?.isConfigured?.() ||
    !window.TeacherData?.verifyAuthEmailUpdate ||
    !window.TeacherData?.getAuthenticatedTeacherEmailSyncState ||
    !window.TeacherData?.syncAuthenticatedTeacherEmail
  ) {
    tokenHash = null;
    button.textContent = "Confirmation Unavailable";
    setStatus("Email confirmation is temporarily unavailable. Reload this page or try again later.", "error");
    return;
  }

  if (tokenHash && verificationType === "email_change") {
    button.textContent = "Confirm Email";
    button.disabled = false;
  } else {
    tokenHash = null;
    actionMode = "sync";
    button.textContent = "Retry Email Sync";
    button.disabled = false;
  }

  async function syncEmail() {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    setStatus("Syncing your verified email to your teacher profile...");

    try {
      const user = await window.TeacherData.syncAuthenticatedTeacherEmail();
      emailDisplay.textContent = `Verified email: ${user.email}`;
      emailDisplay.hidden = false;
      button.hidden = true;
      setStatus("Your email has been successfully updated!", "success");
      window.setTimeout(() => {
        window.location.assign(
          new URL("teacher_content/teacher_dashboard.html", window.location.href).href,
        );
      }, 1400);
    } catch (error) {
      actionMode = "sync";
      tokenHash = null;
      button.textContent = "Retry Email Sync";
      showError("Email sync failed", error);
      button.disabled = false;
    } finally {
      busy = false;
      button.removeAttribute("aria-busy");
    }
  }

  async function inspectAuthenticatedEmail() {
    if (busy) return;
    busy = true;
    setStatus("Checking your authenticated email...");

    try {
      const state = await window.TeacherData.getAuthenticatedTeacherEmailSyncState();
      emailDisplay.textContent = `Authenticated email: ${state.user.email}`;
      emailDisplay.hidden = false;

      if (state.needsSync) {
        actionMode = "sync";
        tokenHash = null;
        button.textContent = "Retry Email Sync";
        busy = false;
        await syncEmail();
        return;
      }

      setStatus(
        actionMode === "confirm"
          ? "Your email is ready to be confirmed."
          : "Your authenticated email is available to synchronize.",
      );
    } catch (error) {
      if (error?.code === "TEACHER_EMAIL_LOOKUP_FAILED") {
        actionMode = "sync";
        tokenHash = null;
        button.textContent = "Retry Email Sync";
        button.disabled = false;
        showError("Email sync could not be checked", error);
      } else if (actionMode === "confirm") {
        setStatus("Click Confirm Email to complete the email confirmation.");
      } else {
        showError("Email sync could not be checked", error);
      }
    } finally {
      busy = false;
    }
  }

  button.addEventListener("click", async () => {
    if (busy) return;
    if (actionMode === "sync") {
      await syncEmail();
      return;
    }

    busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    setStatus("Confirming your email...");

    try {
      if (!tokenHash || verificationType !== "email_change") {
        throw new Error("The email confirmation token is missing or invalid.");
      }

      await window.TeacherData.verifyAuthEmailUpdate(tokenHash);
      tokenHash = null;
      actionMode = "sync";
      busy = false;
      await syncEmail();
    } catch (error) {
      if (actionMode === "confirm") {
        showError("Email confirmation failed", error);
        button.disabled = false;
      }
    } finally {
      busy = false;
      button.removeAttribute("aria-busy");
    }
  });

  void inspectAuthenticatedEmail();
})();
