(() => {
  const heading = document.getElementById("heading");
  const message = document.getElementById("message");
  const loginLink = document.getElementById("loginLink");
  const appRoot = new URL("./", window.location.href);

  function showError(text, headingText = "Unable to complete sign-in") {
    heading.textContent = headingText;
    message.textContent = text;
    loginLink.hidden = false;
  }

  function getProviderError() {
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const error = query.get("error_description") || fragment.get("error_description");
    const errorCode = query.get("error") || fragment.get("error");
    return error || errorCode || null;
  }

  async function completeSignIn() {
    const providerError = getProviderError();
    if (providerError) {
      showError(`Your identity provider could not complete sign-in: ${providerError}`);
      return;
    }

    const client = window.SmartLearningMFA?.getClient?.();
    if (!client) throw new Error("Sign-in is temporarily unavailable. Please try again later.");

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData?.session) {
      throw new Error("No sign-in session was returned. Please try signing in again.");
    }

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!userData?.user) {
      throw new Error("We could not verify your signed-in account. Please try again.");
    }

    if (await window.SmartLearningMFA.needsChallenge(client)) {
      window.location.replace(new URL("verify-2fa.html", appRoot).href);
      return;
    }

    try {
      const dashboardUrl = await window.SmartLearningMFA.resolveDashboard(client);
      window.location.replace(dashboardUrl);
    } catch (error) {
      if (/no teacher or student account is linked/i.test(error?.message || "")) {
        showError(
          "This account authenticated successfully, but no registered learner or teacher profile is linked to it. Contact your school administrator or register an account before signing in.",
          "No registered account found",
        );
        return;
      }
      throw error;
    }
  }

  completeSignIn().catch((error) => {
    console.error("OAuth callback failed.", error);
    showError(error?.message || "We could not complete sign-in. Please try again.");
  });
})();
