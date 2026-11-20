(() => {
  const DUPLICATE_EMAIL_MESSAGE =
    "This email address is already associated with an account. Please use a different email address. Your current email has not been changed.";

  function isDuplicateEmailError(error) {
    if (String(error?.code || "").toLowerCase() === "email_exists") {
      return true;
    }

    const message = String(error?.message || "");
    return (
      Number(error?.status) === 422 &&
      /email/i.test(message) &&
      /already (?:been )?(?:registered|used)|already in use/i.test(message)
    );
  }

  window.SmartLearningEmailChange = Object.freeze({
    getDuplicateEmailMessage(error) {
      return isDuplicateEmailError(error) ? DUPLICATE_EMAIL_MESSAGE : null;
    },
  });
})();
