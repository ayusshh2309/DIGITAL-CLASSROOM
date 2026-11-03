(() => {
  const statusElement = document.getElementById("settingsStatus");
  const saveButton = document.getElementById("saveSettingsButton");
  const profileForm = document.getElementById("profileForm");
  const profileSaveButton = document.getElementById("saveProfileButton");
  const profileCancelButton = document.getElementById("cancelProfileButton");
  const profileEditButton = document.getElementById("editProfileButton");
  const profileSummaryActions = document.getElementById("profileSummaryActions");
  const profilePhotoInput = document.getElementById("profilePhotoInput");
  const profileLanguageSelect = document.getElementById("profileLanguageSelect");
  const profileLanguageTags = document.getElementById("profileLanguageTags");
  const changeEmailButton = document.getElementById("changeEmailButton");
  const changePasswordButton = document.getElementById("changePasswordButton");
  const deleteAccountButton = document.getElementById("deleteAccountButton");
  const accountStatus = document.getElementById("accountStatus");
  const emailDialog = document.getElementById("emailChangeDialog");
  const emailForm = document.getElementById("emailChangeForm");
  const emailInput = document.getElementById("newEmailInput");
  const emailStatus = document.getElementById("emailDialogStatus");
  const emailCurrent = document.getElementById("emailDialogCurrent");
  const emailSubmitButton = document.getElementById("submitEmailButton");
  const emailCancelButton = document.getElementById("cancelEmailButton");
  const passwordDialog = document.getElementById("passwordChangeDialog");
  const passwordForm = document.getElementById("passwordChangeForm");
  const passwordInput = document.getElementById("newPasswordInput");
  const passwordConfirmationInput = document.getElementById("confirmPasswordInput");
  const passwordRequirementsList = document.getElementById("settingsPasswordRequirements");
  const passwordConfirmationStatus = document.getElementById(
    "settingsPasswordConfirmationStatus",
  );
  const passwordStatus = document.getElementById("passwordDialogStatus");
  const passwordSubmitButton = document.getElementById("submitPasswordButton");
  const passwordCancelButton = document.getElementById("cancelPasswordButton");
  if (
    !statusElement || !saveButton || !profileForm || !profileSaveButton ||
    !profileCancelButton || !profileEditButton || !changeEmailButton ||
    !changePasswordButton || !deleteAccountButton || !accountStatus ||
    !emailDialog || !emailForm || !emailInput || !emailStatus || !emailCurrent ||
    !emailSubmitButton || !emailCancelButton || !passwordDialog || !passwordForm ||
    !passwordInput || !passwordConfirmationInput || !passwordRequirementsList ||
    !passwordConfirmationStatus || !passwordStatus ||
    !passwordSubmitButton || !passwordCancelButton
  ) {
    console.error("[TeacherSettings] Cannot initialize; required page elements are missing.", {
      missing: [
        ["settingsStatus", statusElement],
        ["saveSettingsButton", saveButton],
        ["profileForm", profileForm],
        ["saveProfileButton", profileSaveButton],
        ["cancelProfileButton", profileCancelButton],
        ["editProfileButton", profileEditButton],
        ["changeEmailButton", changeEmailButton],
        ["changePasswordButton", changePasswordButton],
        ["deleteAccountButton", deleteAccountButton],
        ["accountStatus", accountStatus],
        ["emailChangeDialog", emailDialog],
        ["emailChangeForm", emailForm],
        ["newEmailInput", emailInput],
        ["emailDialogStatus", emailStatus],
        ["emailDialogCurrent", emailCurrent],
        ["submitEmailButton", emailSubmitButton],
        ["cancelEmailButton", emailCancelButton],
        ["passwordChangeDialog", passwordDialog],
        ["passwordChangeForm", passwordForm],
        ["newPasswordInput", passwordInput],
        ["confirmPasswordInput", passwordConfirmationInput],
        ["settingsPasswordRequirements", passwordRequirementsList],
        ["settingsPasswordConfirmationStatus", passwordConfirmationStatus],
        ["passwordDialogStatus", passwordStatus],
        ["submitPasswordButton", passwordSubmitButton],
        ["cancelPasswordButton", passwordCancelButton],
      ].filter(([, element]) => !element).map(([id]) => id),
    });
    return;
  }

  passwordSubmitButton.disabled = true;
  const accountActionButtons = [
    profileEditButton,
    changeEmailButton,
    changePasswordButton,
    deleteAccountButton,
  ];

  const PROFILE_FIELDS = [
    "full_name",
    "phone_number",
    "country_code",
    "date_of_birth",
    "gender",
    "country",
    "state",
    "city",
    "highest_qualification",
    "degree_course",
    "specialization",
    "university_college",
    "graduation_year",
    "institution_name",
    "institution_type",
    "employment_status",
    "years_experience",
    "languages",
    "address",
    "bio",
  ];

  let client = null;
  let user = null;
  let profile = null;
  let settings = null;
  let settingsChannel = null;
  let profileChannel = null;
  let stopAuthWatch = null;
  let authSubscription = null;
  let settingsDirty = false;
  let savingSettings = false;
  let savingProfile = false;
  let profileDirty = false;
  let previewUrl = null;
  let changingEmail = false;
  let changingPassword = false;
  let deletingAccount = false;
  saveButton.disabled = true;
  profileSaveButton.disabled = true;
  accountActionButtons.forEach((button) => {
    if (button) button.disabled = true;
  });

  const setStatus = (message) => {
    statusElement.textContent = message;
  };

  const setAccountStatus = (message) => {
    accountStatus.textContent = message;
  };

  const setProfileStatus = (message) => {
    const element = document.getElementById("profileStatus");
    if (element) element.textContent = message;
  };

  const realtimeWarnings = new Set();
  const realtimeErrorMessage = (error, status) => {
    if (typeof error === "string" && error) return error;
    if (error?.message) return error.message;
    if (error?.reason) {
      return typeof error.reason === "string"
        ? error.reason
        : error.reason.message || status || "Unknown Realtime error";
    }
    return status || "Unknown Realtime error";
  };
  const updateRealtimeWarning = (key, label, status, error) => {
    if (status === "SUBSCRIBED") {
      realtimeWarnings.delete(key);
    } else {
      const details = realtimeErrorMessage(error, status);
      realtimeWarnings.add(`${label} live updates are unavailable (${details}).`);
    }
    if (realtimeWarnings.size) {
      setAccountStatus(`Warning: ${[...realtimeWarnings].join(" ")}`);
    } else if (accountStatus.textContent.startsWith("Warning:")) {
      setAccountStatus("");
    }
  };

  const errorMessage = (error, fallback) => {
    if (error instanceof Error && error.message) return error.message;
    if (error && typeof error.message === "string" && error.message) return error.message;
    return fallback;
  };

  const formatAuthError = (error) => {
    const message = errorMessage(error, "Unknown Supabase Auth error");
    const code = error?.code ? ` Code: ${error.code}.` : "";
    const status = error?.status ? ` HTTP status: ${error.status}.` : "";
    const details = error?.details ? ` Details: ${error.details}` : "";
    const hint = error?.hint ? ` Hint: ${error.hint}` : "";
    return `${message}${code}${status}${details}${hint}`;
  };

  const passwordErrorText = (value) => {
    const text = typeof value === "string" ? value : "";
    return passwordInput.value
      ? text.split(passwordInput.value).join("[redacted]")
      : text;
  };

  const logSupabaseError = (stage, error) => {
    console.error(`[TeacherSettings] ${stage} failed. Supabase error response:`, {
      name: error?.name || "SupabaseError",
      code: error?.code || null,
      status: error?.status || null,
      message: errorMessage(error, "Unknown error"),
      details: error?.details || null,
      hint: error?.hint || null,
    });
  };

  const enableAccountActions = (enabled) => {
    accountActionButtons.forEach((button) => {
      if (button) button.disabled = !enabled;
    });
  };

  const setValue = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value || "-";
  };

  function populateGraduationYears() {
    const select = document.querySelector('[data-profile-field="graduation_year"]');
    if (!select || select.options.length > 1) return;
    const currentYear = new Date().getFullYear();
    for (let year = currentYear; year >= 1970; year -= 1) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      select.appendChild(option);
    }
  }

  function setProfileSelectValue(select, value) {
    Array.from(select.options)
      .filter((option) => option.dataset.profileExistingValue === "true")
      .forEach((option) => option.remove());

    if (select.multiple) {
      const values = Array.isArray(value)
        ? value.map(String)
        : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
      values.forEach((item) => {
        if (Array.from(select.options).some((option) => option.value === item)) return;
        const option = document.createElement("option");
        option.value = item;
        option.textContent = item;
        option.dataset.profileExistingValue = "true";
        select.appendChild(option);
      });
      Array.from(select.options).forEach((option) => {
        option.selected = values.includes(option.value);
      });
      return;
    }

    const selectedValue = value === null || value === undefined ? "" : String(value);
    if (
      selectedValue &&
      !Array.from(select.options).some((option) => option.value === selectedValue)
    ) {
      const option = document.createElement("option");
      option.value = selectedValue;
      option.textContent = selectedValue;
      option.dataset.profileExistingValue = "true";
      select.appendChild(option);
    }
    select.value = selectedValue;
  }

  function renderProfileLanguages(languages) {
    if (!profileLanguageTags) return;
    profileLanguageTags.replaceChildren();
    const values = Array.isArray(languages)
      ? languages.map((language) => String(language).trim()).filter(Boolean)
      : [];
    values.forEach((language) => {
      const tag = document.createElement("span");
      tag.className = "profile-language-tag";
      tag.dataset.language = language;

      const label = document.createElement("span");
      label.textContent = language;

      const removeButton = document.createElement("button");
      removeButton.className = "profile-language-remove";
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `Remove ${language}`);

      tag.append(label, removeButton);
      profileLanguageTags.appendChild(tag);
    });
  }

  function addProfileLanguage() {
    const language = profileLanguageSelect?.value;
    if (!language || !profileLanguageTags) return;
    const selected = Array.from(
      profileLanguageTags.querySelectorAll("[data-language]"),
      (tag) => tag.dataset.language,
    );
    if (!selected.includes(language)) {
      renderProfileLanguages([...selected, language]);
    }
    profileLanguageSelect.value = "";
    profileDirty = hasUnsavedProfileChanges();
    setProfileStatus(profileDirty ? "Unsaved profile changes." : "");
  }

  populateGraduationYears();

  const passwordValidator = window.RegistrationPasswordValidation;
  if (!passwordValidator?.check) {
    console.error("[TeacherSettings] Shared registration password validation helper did not load.");
  } else {
    passwordValidator.check("").requirements.forEach((requirement) => {
      const item = document.createElement("li");
      item.dataset.passwordRequirement = requirement.key;
      item.textContent = requirement.label;
      passwordRequirementsList.appendChild(item);
    });
  }

  function updatePasswordValidation() {
    if (!passwordValidator?.check) {
      passwordSubmitButton.disabled = true;
      return false;
    }

    const result = passwordValidator.check(passwordInput.value);
    result.requirements.forEach((requirement) => {
      const item = passwordRequirementsList.querySelector(
        `[data-password-requirement="${requirement.key}"]`,
      );
      if (!item) return;
      item.classList.toggle("is-met", requirement.satisfied);
      item.setAttribute(
        "aria-label",
        `${requirement.satisfied ? "Satisfied" : "Not satisfied"}: ${requirement.label}`,
      );
    });

    const confirmation = passwordConfirmationInput.value;
    const matches = Boolean(confirmation) && confirmation === passwordInput.value;
    passwordConfirmationStatus.textContent = !confirmation
      ? ""
      : matches
        ? "Passwords match."
        : "Passwords do not match.";
    passwordConfirmationStatus.classList.toggle("is-matched", matches);
    passwordConfirmationInput.setAttribute("aria-invalid", confirmation && !matches ? "true" : "false");
    passwordSubmitButton.disabled = changingPassword || !result.valid || !matches;
    return result.valid && matches;
  }

  function showPasswordValidationMessage() {
    if (!passwordValidator?.check) {
      passwordStatus.textContent = "Password validation is unavailable. Reload the page and try again.";
      return;
    }
    const result = passwordValidator.check(passwordInput.value);
    if (!result.valid) {
      passwordStatus.textContent = passwordInput.value
        ? "Password must meet all four requirements."
        : "";
    } else if (passwordConfirmationInput.value && passwordConfirmationInput.value !== passwordInput.value) {
      passwordStatus.textContent = "The passwords do not match.";
    } else {
      passwordStatus.textContent = "";
    }
  }

  function readSettings() {
    return {
      time_format:
        document.querySelector('[data-setting="time_format"]:checked')?.value || "",
    };
  }

  function renderSettings() {
    document.querySelectorAll('[data-setting="time_format"]').forEach((control) => {
      control.checked = control.value === settings.time_format;
      control.disabled = false;
    });
    settingsDirty = false;
    updateSettingsSaveButton();
  }

  function updateSettingsSaveButton() {
    saveButton.disabled = savingSettings || !settingsDirty;
  }

  function readProfileValues() {
    return Object.fromEntries(
      PROFILE_FIELDS.map((field) => {
        if (field === "languages") {
          return [
            field,
            Array.from(profileLanguageTags?.querySelectorAll("[data-language]") || [],
              (tag) => tag.dataset.language),
          ];
        }
        const input = document.querySelector(`[data-profile-field="${field}"]`);
        if (!input) return [field, null];
        if (field === "years_experience" || field === "graduation_year") {
          return [field, input.value === "" ? null : Number(input.value)];
        }
        const value = input.value.trim();
        return [field, value || null];
      }),
    );
  }

  function currentProfileValue(field) {
    const value = profile?.[field];
    if (field === "languages") return Array.isArray(value) ? value : [];
    if (field === "date_of_birth" && value) return String(value).slice(0, 10);
    if (field === "years_experience" || field === "graduation_year") {
      return value === null || value === undefined || value === ""
        ? null
        : Number(value);
    }
    return value ?? null;
  }

  function profileValueMatches(field, left, right) {
    if (field === "languages") return JSON.stringify(left) === JSON.stringify(right);
    return left === right;
  }

  function updateEmploymentRequirements() {
    const employmentStatus = document.querySelector(
      '[data-profile-field="employment_status"]',
    )?.value.trim().toLowerCase();
    const teaching = employmentStatus === "teaching";
    ["institution_name", "institution_type", "years_experience"].forEach((field) => {
      const input = document.querySelector(`[data-profile-field="${field}"]`);
      if (input) input.required = teaching;
    });
  }

  function hasUnsavedProfileChanges() {
    const values = readProfileValues();
    const hasFieldChanges = PROFILE_FIELDS.some(
      (field) => !profileValueMatches(field, values[field], currentProfileValue(field)),
    );
    return hasFieldChanges || Boolean(profilePhotoInput?.files?.length);
  }

  async function renderAccount() {
    setValue("settingsTeacherName", profile.full_name);
    setValue("settingsTeacherEmail", user.email);
    setValue("settingsEmailStatus", `Current email: ${user.email || "-"}`);
    emailCurrent.textContent = `Current email: ${user.email || "-"}`;
    setValue("settingsTeacherPhone", profile.phone_number);
    setValue(
      "settingsTeacherRole",
      profile.teaching_mode === "subject_specialist"
        ? "Teacher · Subject Specialist"
        : "Teacher · Educator",
    );

    PROFILE_FIELDS.forEach((field) => {
      if (field === "languages") {
        renderProfileLanguages(profile[field]);
        return;
      }
      const input = document.querySelector(`[data-profile-field="${field}"]`);
      if (!input) return;
      const value = profile[field];
      if (field === "date_of_birth" && value) {
        input.value = String(value).slice(0, 10);
      } else if (input instanceof HTMLSelectElement) {
        setProfileSelectValue(input, value);
      } else if (field === "languages") {
        input.value = Array.isArray(value) ? value.join(", ") : value ?? "";
      } else {
        input.value = value ?? "";
      }
    });
    updateEmploymentRequirements();

    const avatar = document.getElementById("settingsAvatar");
    if (!avatar) return;
    if (!profile.profile_photo_url) {
      avatar.removeAttribute("src");
      avatar.hidden = true;
      return;
    }
    try {
      avatar.src = await TeacherData.getTeacherProfilePhotoUrl(profile.profile_photo_url);
      avatar.alt = profile.full_name
        ? `${profile.full_name}'s profile photo`
        : "Teacher profile photo";
      avatar.hidden = false;
      return false;
    } catch (error) {
      console.error("Unable to load the teacher profile photo.", error);
      avatar.hidden = true;
      setAccountStatus(
        `Profile loaded, but the saved photo could not be displayed: ${errorMessage(error, "Please try again later.")}`,
      );
      return true;
    }
  }

  function setProfileEditorOpen(isOpen) {
    profileForm.hidden = !isOpen;
    profileSummaryActions.hidden = isOpen;
    profileEditButton.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      profileDirty = false;
      setProfileStatus("");
    }
  }

  function discardProfileChanges() {
    if (profilePhotoInput) profilePhotoInput.value = "";
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    profileDirty = false;
    void renderAccount();
    setProfileStatus("");
    setProfileEditorOpen(false);
  }

  async function saveSettings() {
    if (savingSettings) return;
    if (!settingsDirty) {
      setStatus("No changes to save.");
      return;
    }
    if (!navigator.onLine) {
      setStatus("You are offline. Settings were not saved.");
      return;
    }

    const values = readSettings();
    if (!["12h", "24h"].includes(values.time_format)) {
      setStatus("Choose a valid time format.");
      return;
    }

    savingSettings = true;
    updateSettingsSaveButton();
    document.querySelectorAll('[data-setting="time_format"]').forEach((control) => {
      control.disabled = true;
    });
    setStatus("Saving...");
    try {
      await TeacherData.updateCurrentTeacherSettings(values);
      settings = await TeacherData.loadCurrentTeacherSettings();
      settingsDirty = false;
      renderSettings();
      setStatus("Settings saved successfully.");
    } catch (error) {
      logSupabaseError("Teacher settings save or refresh", error);
      setStatus(navigator.onLine
        ? `Unable to save or refresh settings: ${errorMessage(error, "Please try again.")}`
        : "You are offline. Settings were not saved.");
    } finally {
      savingSettings = false;
      document.querySelectorAll('[data-setting="time_format"]').forEach((control) => {
        control.disabled = false;
      });
      updateSettingsSaveButton();
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (savingProfile) return;
    console.info("[TeacherSettings] Profile save requested.");
    if (!navigator.onLine) {
      setProfileStatus("You are offline. Profile changes were not saved.");
      return;
    }
    if (!profileForm.reportValidity()) return;

    const values = readProfileValues();
    if (["years_experience", "graduation_year"].some(
      (field) => values[field] !== null && !Number.isInteger(values[field]),
    )) {
      setProfileStatus("Experience and graduation year must be whole numbers.");
      return;
    }
    const changes = Object.fromEntries(
      PROFILE_FIELDS
        .filter((field) => !profileValueMatches(
          field,
          values[field],
          currentProfileValue(field),
        ))
        .map((field) => [field, values[field]]),
    );
    const selectedPhoto = profilePhotoInput?.files?.[0] || null;
    if (!selectedPhoto && !Object.keys(changes).length) {
      profileDirty = false;
      setProfileStatus("No profile changes to save.");
      return;
    }

    savingProfile = true;
    profileSaveButton.disabled = true;
    profileCancelButton.disabled = true;
    setProfileStatus("Saving profile...");
    let uploadedPhotoPath = null;
    let profileSaved = false;
    const warnings = [];
    const previousPhotoPath = profile.profile_photo_url;
    try {
      if (selectedPhoto) {
        uploadedPhotoPath = await TeacherData.uploadTeacherProfilePhoto(selectedPhoto);
        changes.profile_photo_url = uploadedPhotoPath;
      }

      profile = await TeacherData.updateCurrentTeacherProfile(changes);
      profileSaved = true;
      try {
        const loaded = await TeacherData.loadCurrentTeacherProfile();
        profile = loaded.profile;
        user = loaded.user;
      } catch (error) {
        console.error("Profile saved, but refreshing the teacher profile failed.", error);
        warnings.push(
          `the latest details could not be refreshed (${errorMessage(error, "Please reload the page.")})`,
        );
      }
      profileDirty = false;
      if (profilePhotoInput) profilePhotoInput.value = "";
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      const photoUnavailable = await renderAccount();
      if (photoUnavailable) warnings.push("the saved photo could not be displayed");
      setProfileEditorOpen(false);

      if (previousPhotoPath && previousPhotoPath !== profile.profile_photo_url) {
        try {
          await TeacherData.deleteTeacherProfilePhoto(previousPhotoPath);
        } catch (error) {
          console.error("Unable to remove the previous teacher profile photo.", error);
          warnings.push(
            `the previous photo could not be removed (${errorMessage(error, "Storage cleanup failed.")})`,
          );
        }
      }
      setAccountStatus(
        warnings.length
          ? `Profile saved, but ${warnings.join("; and ")}.`
          : "Profile saved successfully.",
      );
    } catch (error) {
      logSupabaseError("Profile save", error);
      if (uploadedPhotoPath && !profileSaved) {
        try {
          await TeacherData.deleteTeacherProfilePhoto(uploadedPhotoPath);
        } catch (cleanupError) {
          console.error("Unable to remove an unlinked profile photo.", cleanupError);
        }
      }
      setProfileStatus(navigator.onLine
        ? `Unable to save your profile: ${errorMessage(error, "Please try again.")}`
        : "You are offline. Profile changes were not saved.");
    } finally {
      savingProfile = false;
      profileSaveButton.disabled = false;
      profileCancelButton.disabled = false;
    }
  }

  async function changeEmail() {
    if (changingEmail) return;
    console.info("[TeacherSettings] Email update requested.");
    if (!navigator.onLine) {
      emailStatus.textContent = "You are offline. The email change was not requested.";
      return;
    }
    const newEmail = emailInput.value.trim();
    console.info("[TeacherSettings] Email input verification:", {
      inputId: emailInput.id,
      hasValue: Boolean(newEmail),
      differsFromCurrent:
        newEmail.toLowerCase() !==
        String(user?.email || "").trim().toLowerCase(),
    });
    emailInput.value = newEmail;
    if (!emailInput.reportValidity()) return;
    if (newEmail.toLowerCase() === String(user.email || "").toLowerCase()) {
      emailStatus.textContent = "Enter an email address different from your current email.";
      emailInput.focus();
      return;
    }
    changingEmail = true;
    emailSubmitButton.disabled = true;
    emailStatus.textContent = "Requesting email change...";
    try {
      console.info("[TeacherSettings] Sending trimmed email to Supabase Auth.");
      await TeacherData.updateAuthEmail(newEmail);
      emailStatus.textContent =
        "Email change requested. Check your inbox and follow Supabase's confirmation steps. Your displayed email will update after confirmation.";
    } catch (error) {
      logSupabaseError("Email update", error);
      emailStatus.textContent = `Unable to request the email change: ${formatAuthError(error)}`;
    } finally {
      changingEmail = false;
      emailSubmitButton.disabled = false;
    }
  }

  async function changePassword() {
    if (changingPassword) return;
    console.info("[TeacherSettings] Password update requested.");
    if (!passwordValidator?.check) {
      passwordStatus.textContent = "Password validation is unavailable. Reload the page and try again.";
      return;
    }
    const passwordResult = passwordValidator.check(passwordInput.value);
    if (!passwordResult.valid) {
      passwordStatus.textContent = "Password must meet all four requirements.";
      passwordInput.focus();
      updatePasswordValidation();
      return;
    }
    if (!passwordConfirmationInput.value || passwordInput.value !== passwordConfirmationInput.value) {
      passwordStatus.textContent = passwordConfirmationInput.value
        ? "The passwords do not match."
        : "Please confirm your password.";
      passwordConfirmationInput.focus();
      updatePasswordValidation();
      return;
    }
    if (!navigator.onLine) {
      passwordStatus.textContent = "You are offline. The password was not changed.";
      return;
    }
    changingPassword = true;
    updatePasswordValidation();
    passwordStatus.textContent = "Updating password...";
    try {
      await TeacherData.updateAuthPassword(passwordInput.value);
      passwordInput.value = "";
      passwordConfirmationInput.value = "";
      updatePasswordValidation();
      passwordStatus.textContent = "Password updated successfully.";
    } catch (error) {
      console.error("[TeacherSettings] Password update failed.", {
        code: error?.code || null,
        status: error?.status || null,
        message: passwordErrorText(errorMessage(error, "Please try again.")),
        details: passwordErrorText(error?.details || ""),
        hint: passwordErrorText(error?.hint || ""),
      });
      passwordStatus.textContent =
        `Unable to update your password: ${passwordErrorText(errorMessage(error, "Please try again."))}`;
    } finally {
      changingPassword = false;
      updatePasswordValidation();
    }
  }

  async function deleteAccount() {
    if (deletingAccount) return;
    if (!navigator.onLine) {
      setAccountStatus("You are offline. Account deletion was not requested.");
      return;
    }
    if (!window.confirm("Delete your account and associated profile? This action is permanent.")) return;
    const confirmation = window.prompt('Type DELETE MY ACCOUNT to confirm:');
    if (confirmation !== "DELETE MY ACCOUNT") {
      setAccountStatus("Account deletion was cancelled.");
      return;
    }

    deletingAccount = true;
    deleteAccountButton.disabled = true;
    setAccountStatus("Deleting account...");
    let deletionSucceeded = false;
    try {
      const { data, error } = await client.functions.invoke("delete-account", {
        body: { confirmation },
      });
      if (error) throw error;
      if (data?.deleted !== true) {
        throw new Error("The account deletion function did not confirm deletion.");
      }
      deletionSucceeded = true;
      if (data.profilePhotoCleanupFailed) {
        console.error("The account was deleted, but profile photo cleanup failed.");
      }

      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) throw signOutError;
      window.location.assign("../teacher_registration/login.html");
    } catch (error) {
      console.error("Unable to delete or sign out of the teacher account.", error);
      setAccountStatus(deletionSucceeded
        ? `Your account was deleted, but sign-out failed: ${errorMessage(error, "close this page and sign in again if needed.")}`
        : `Account deletion failed. Your account was not deleted: ${errorMessage(error, "please try again later.")}`);
      if (!deletionSucceeded) {
        deletingAccount = false;
        deleteAccountButton.disabled = false;
      }
    }
  }

  document.querySelectorAll('[data-setting="time_format"]').forEach((control) => {
    control.addEventListener("change", () => {
      settingsDirty = readSettings().time_format !== settings?.time_format;
      updateSettingsSaveButton();
      setStatus(settingsDirty ? "Unsaved changes." : "");
    });
  });

  document.querySelectorAll("[data-profile-field]").forEach((control) => {
    control.addEventListener(control instanceof HTMLSelectElement ? "change" : "input", () => {
      if (control.dataset.profileField === "employment_status") {
        updateEmploymentRequirements();
      }
      profileDirty = hasUnsavedProfileChanges();
      setProfileStatus(profileDirty ? "Unsaved profile changes." : "");
    });
  });
  profileLanguageSelect?.addEventListener("change", addProfileLanguage);
  profileLanguageTags?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".profile-language-remove");
    if (!removeButton) return;
    removeButton.closest("[data-language]")?.remove();
    profileDirty = hasUnsavedProfileChanges();
    setProfileStatus(profileDirty ? "Unsaved profile changes." : "");
  });
  updateEmploymentRequirements();

  profilePhotoInput?.addEventListener("change", () => {
    const file = profilePhotoInput.files?.[0];
    const avatar = document.getElementById("settingsAvatar");
    if (!file || !avatar) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    avatar.src = previewUrl;
    avatar.alt = "Selected teacher profile photo preview";
    avatar.hidden = false;
    profileDirty = hasUnsavedProfileChanges();
    setProfileStatus("Selected photo will be uploaded when you save your profile.");
  });

  profileEditButton.addEventListener("click", () => {
    console.info("[TeacherSettings] Edit Profile clicked.");
    void renderAccount();
    setProfileEditorOpen(true);
    profileForm.querySelector('[data-profile-field="full_name"]')?.focus();
  });
  profileCancelButton.addEventListener("click", discardProfileChanges);
  profileForm.addEventListener("submit", saveProfile);
  saveButton.addEventListener("click", saveSettings);
  changeEmailButton.addEventListener("click", () => {
    console.info("[TeacherSettings] Change Email clicked.");
    emailForm.reset();
    emailInput.value = "";
    emailStatus.textContent = "";
    emailCurrent.textContent = `Current email: ${user?.email || "-"}`;
    emailDialog.showModal();
    emailInput.focus();
  });
  emailForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void changeEmail();
  });
  emailCancelButton.addEventListener("click", () => {
    emailForm.reset();
    emailStatus.textContent = "";
    emailDialog.close();
  });
  emailDialog.addEventListener("close", () => {
    if (!changingEmail) emailForm.reset();
  });
  emailDialog.addEventListener("cancel", (event) => {
    if (changingEmail) event.preventDefault();
  });
  const onPasswordInput = () => {
    updatePasswordValidation();
    showPasswordValidationMessage();
  };
  passwordInput.addEventListener("input", onPasswordInput);
  passwordConfirmationInput.addEventListener("input", onPasswordInput);
  changePasswordButton.addEventListener("click", () => {
    console.info("[TeacherSettings] Change Password clicked.");
    passwordForm.reset();
    passwordStatus.textContent = "";
    updatePasswordValidation();
    passwordDialog.showModal();
    passwordInput.focus();
  });
  passwordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void changePassword();
  });
  passwordCancelButton.addEventListener("click", () => {
    passwordForm.reset();
    passwordStatus.textContent = "";
    updatePasswordValidation();
    passwordDialog.close();
  });
  passwordDialog.addEventListener("close", () => {
    if (!changingPassword) {
      passwordForm.reset();
      updatePasswordValidation();
    }
  });
  passwordDialog.addEventListener("cancel", (event) => {
    if (changingPassword) event.preventDefault();
  });
  deleteAccountButton.addEventListener("click", () => {
    void deleteAccount();
  });

  window.addEventListener("beforeunload", () => {
    profileChannel?.unsubscribe();
    settingsChannel?.unsubscribe();
    stopAuthWatch?.();
    authSubscription?.unsubscribe();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });

  async function initialize() {
    console.info("[TeacherSettings] Initialization started.");
    setStatus("Loading settings...");
    console.info("[TeacherSettings] Loading authenticated teacher profile.");
    const loaded = await TeacherData.loadCurrentTeacherProfile();
    client = loaded.client;
    user = loaded.user;
    profile = loaded.profile;
    console.info("[TeacherSettings] Authenticated teacher profile loaded.", {
      teacherId: profile.id,
      authenticatedUserId: user.id,
    });
    await renderAccount();
    profileSaveButton.disabled = false;
    enableAccountActions(true);
    changePasswordButton.disabled = !passwordValidator?.check;

    console.info("[TeacherSettings] Loading teacher time-format settings.");
    let settingsLoaded = false;
    try {
      settings = await TeacherData.loadCurrentTeacherSettings();
      settingsLoaded = true;
      console.info("[TeacherSettings] Teacher settings loaded.", {
        teacherId: profile.id,
        timeFormat: settings.time_format,
      });
      renderSettings();
      setStatus("");
    } catch (error) {
      logSupabaseError("Teacher settings load", error);
      document.querySelectorAll('[data-setting="time_format"]').forEach((control) => {
        control.disabled = true;
      });
      saveButton.disabled = true;
      setStatus(
        `Unable to load time-format settings: ${errorMessage(error, "Please try again.")}`,
      );
    }

    try {
      profileChannel = TeacherData.subscribeToTeacherProfile(
        profile.id,
        (event) => {
          if (event.eventType === "DELETE") {
            void TeacherData.handleUnavailableTeacher(client);
            return;
          }
          if (event.new) {
            if (profileDirty) {
              setAccountStatus("Your profile changed on another session. Review your edits before saving.");
              return;
            }
            profile = event.new;
            void renderAccount();
          }
        },
        (status, error) => {
          updateRealtimeWarning("profile", "Profile", status, error);
        },
      );
    } catch (error) {
      logSupabaseError("Teacher profile Realtime subscription", error);
      updateRealtimeWarning("profile", "Profile", "CHANNEL_ERROR", error);
    }
    try {
      settingsChannel = TeacherData.subscribeToTeacherSettings(
        profile.id,
        (event) => {
          if (!event.new) return;
          if (settingsDirty || savingSettings) {
            setStatus("Settings changed on another device. Save to keep your edits.");
            return;
          }
          settings = event.new;
          renderSettings();
          setStatus("Settings updated from another session.");
        },
        (status, error) => {
          updateRealtimeWarning("settings", "Settings", status, error);
        },
      );
    } catch (error) {
      logSupabaseError("Teacher settings Realtime subscription", error);
      updateRealtimeWarning("settings", "Settings", "CHANNEL_ERROR", error);
    }
    stopAuthWatch = TeacherData.watchAuthState(() => {
      window.location.assign("../teacher_registration/login.html");
    });
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "USER_UPDATED" && session?.user) {
        user = session.user;
        setValue("settingsTeacherEmail", user.email);
        setValue("settingsEmailStatus", `Current email: ${user.email || "-"}`);
        emailCurrent.textContent = `Current email: ${user.email || "-"}`;
      }
    });
    authSubscription = data.subscription;
    if (!settingsLoaded) {
      console.warn("[TeacherSettings] Account actions are available; time-format settings are not.");
    }
    console.info("[TeacherSettings] Initialization complete.");
  }

  const start = () => {
    initialize().catch((error) => {
      logSupabaseError("Teacher profile initialization", error);
      setStatus(`Unable to load your teacher profile: ${errorMessage(error, "Please sign in again or try later.")}`);
      saveButton.disabled = true;
      profileSaveButton.disabled = true;
      enableAccountActions(false);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
