(() => {
  const REQUIREMENTS = [
    { key: "length", label: "At least 8 characters", test: (password) => password.length >= 8 },
    { key: "uppercase", label: "One uppercase letter (A-Z)", test: (password) => /[A-Z]/.test(password) },
    { key: "lowercase", label: "One lowercase letter (a-z)", test: (password) => /[a-z]/.test(password) },
    { key: "special", label: "One special character (@, #, $, !)", test: (password) => /[^A-Za-z0-9\s]/.test(password) },
  ];

  function check(password) {
    const value = typeof password === "string" ? password : "";
    const requirements = REQUIREMENTS.map((requirement) => ({
      ...requirement,
      satisfied: requirement.test(value),
    }));
    const score = requirements.filter((requirement) => requirement.satisfied).length;
    return { requirements, score, valid: score === REQUIREMENTS.length };
  }

  function init() {
    const passwordInput = document.getElementById("password");
    const confirmInput = document.getElementById("confirmPassword");
    const requirementsList = document.getElementById("passwordRequirements");
    const strengthText = document.getElementById("passwordStrengthText");
    const strengthMeter = document.getElementById("passwordStrengthMeter");
    const passwordMessage = document.getElementById("passwordValidationMessage");
    const confirmMessage = document.getElementById("confirmPasswordValidation");
    const visibilityToggles = document.querySelectorAll(".password-visibility-toggle");

    if (![passwordInput, confirmInput, requirementsList, strengthText, strengthMeter, passwordMessage, confirmMessage].every(Boolean)) {
      throw new Error("The password validation elements are missing from this registration page.");
    }

    const requirementElements = REQUIREMENTS.map((requirement) => {
      const item = document.createElement("li");
      item.dataset.requirement = requirement.key;
      item.textContent = requirement.label;
      requirementsList.appendChild(item);
      return item;
    });

    let confirmTouched = false;
    let showPasswordError = false;

    function render() {
      const result = check(passwordInput.value);
      requirementElements.forEach((element, index) => {
        const satisfied = result.requirements[index].satisfied;
        element.classList.toggle("is-met", satisfied);
        element.setAttribute("aria-label", `${satisfied ? "Satisfied" : "Not satisfied"}: ${REQUIREMENTS[index].label}`);
      });

      const strength = result.score === 4
        ? "Strong"
        : result.score === 3
          ? "Medium"
          : result.score > 0
            ? "Weak"
            : "Not rated";
      strengthText.querySelector("[data-strength-value]").textContent = strength;
      strengthMeter.dataset.score = String(result.score);
      strengthMeter.setAttribute("aria-valuenow", String(result.score));

      passwordMessage.textContent = result.valid
        ? "Password requirements satisfied."
        : showPasswordError
          ? "Password must satisfy all four requirements."
          : "";
      passwordMessage.classList.toggle("is-success", result.valid);
      passwordMessage.classList.toggle("is-error", !result.valid && showPasswordError);

      const confirmation = confirmInput.value;
      const matches = Boolean(confirmation) && confirmation === passwordInput.value;
      const hasConfirmation = confirmTouched || showPasswordError;
      confirmMessage.textContent = matches
        ? "Passwords match."
        : hasConfirmation
          ? confirmation
            ? "Passwords do not match."
            : "Please confirm your password."
          : "";
      confirmMessage.classList.toggle("is-success", matches);
      confirmMessage.classList.toggle("is-error", hasConfirmation && !matches);
      confirmInput.setAttribute("aria-invalid", hasConfirmation && !matches ? "true" : "false");
      passwordInput.setAttribute("aria-invalid", showPasswordError && !result.valid ? "true" : "false");
    }

    function validate() {
      showPasswordError = true;
      confirmTouched = true;
      render();
      const passwordResult = check(passwordInput.value);
      const confirmationMatches = Boolean(confirmInput.value) && confirmInput.value === passwordInput.value;
      return {
        valid: passwordResult.valid && confirmationMatches,
        field: !passwordResult.valid ? passwordInput : confirmInput,
        message: !passwordResult.valid
          ? "Password must satisfy all four requirements."
          : "Passwords do not match.",
      };
    }

    passwordInput.addEventListener("input", render);
    confirmInput.addEventListener("input", () => {
      confirmTouched = true;
      render();
    });
    passwordInput.addEventListener("invalid", () => {
      showPasswordError = true;
      render();
    });
    confirmInput.addEventListener("invalid", () => {
      confirmTouched = true;
      render();
    });
    visibilityToggles.forEach((toggle) => {
      const input = document.getElementById(toggle.getAttribute("aria-controls"));
      if (!input) {
        throw new Error("A password visibility toggle has no matching input.");
      }

      toggle.addEventListener("click", () => {
        const isVisible = input.type === "text";
        input.type = isVisible ? "password" : "text";
        toggle.setAttribute("aria-pressed", String(!isVisible));
        toggle.setAttribute("aria-label", `${isVisible ? "Show" : "Hide"} ${input.id === "confirmPassword" ? "confirm password" : "password"}`);
      });
    });
    render();

    return { validate, check };
  }

  window.RegistrationPasswordValidation = { check, init };
})();
