(() => {
  const PHOTO_BUCKET = "student-profile-images";
  const PROFILE_FIELDS = [
    "full_name",
    "phone",
    "date_of_birth",
    "gender",
    "father_name",
    "father_phone",
    "mother_name",
    "mother_phone",
    "country",
    "state",
    "city",
    "address",
  ];
  const PROFILE_COLUMNS = [
    "id",
    "user_id",
    "student_id",
    "full_name",
    "email",
    "phone",
    "date_of_birth",
    "gender",
    "father_name",
    "father_phone",
    "mother_name",
    "mother_phone",
    "country",
    "state",
    "city",
    "address",
    "profile_photo_url",
    "grade",
    "stream",
    "school_name",
  ].join(", ");
  const DEFAULT_SETTINGS = {
    time_format: "12h",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
    language: "English",
  };

  const elements = {
    profileForm: document.getElementById("profileForm"),
    profileSummary: document.getElementById("profileSummaryActions"),
    editProfile: document.getElementById("editProfileButton"),
    saveProfile: document.getElementById("saveProfileButton"),
    cancelProfile: document.getElementById("cancelProfileButton"),
    photoInput: document.getElementById("profilePhotoInput"),
    profileStatus: document.getElementById("profileStatus"),
    accountStatus: document.getElementById("accountStatus"),
    accountName: document.getElementById("settingsStudentName"),
    accountEmail: document.getElementById("settingsStudentEmail"),
    accountPhone: document.getElementById("settingsStudentPhone"),
    accountDetails: document.getElementById("settingsStudentDetails"),
    avatar: document.getElementById("settingsAvatar"),
    emailStatus: document.getElementById("settingsEmailStatus"),
    emailDialog: document.getElementById("emailChangeDialog"),
    emailForm: document.getElementById("emailChangeForm"),
    emailInput: document.getElementById("newEmailInput"),
    emailCurrent: document.getElementById("emailDialogCurrent"),
    emailStatusDialog: document.getElementById("emailDialogStatus"),
    emailSubmit: document.getElementById("submitEmailButton"),
    emailCancel: document.getElementById("cancelEmailButton"),
    passwordDialog: document.getElementById("passwordChangeDialog"),
    passwordForm: document.getElementById("passwordChangeForm"),
    passwordInput: document.getElementById("newPasswordInput"),
    passwordConfirm: document.getElementById("confirmPasswordInput"),
    passwordRequirements: document.getElementById("settingsPasswordRequirements"),
    passwordConfirmationStatus: document.getElementById("settingsPasswordConfirmationStatus"),
    passwordStatus: document.getElementById("passwordDialogStatus"),
    passwordSubmit: document.getElementById("submitPasswordButton"),
    passwordCancel: document.getElementById("cancelPasswordButton"),
    changeEmail: document.getElementById("changeEmailButton"),
    changePassword: document.getElementById("changePasswordButton"),
    deleteAccount: document.getElementById("deleteAccountButton"),
    saveSettings: document.getElementById("saveSettingsButton"),
    settingsStatus: document.getElementById("settingsStatus"),
    timezone: document.getElementById("studentTimezoneSelect"),
  };

  if (Object.values(elements).some((element) => !element)) {
    console.error("[StudentSettings] Cannot initialize; required page elements are missing.");
    return;
  }

  let client;
  let user;
  let profile;
  let settings;
  let savedSettings;
  let previewUrl = null;
  let savingProfile = false;
  let savingSettings = false;
  let changingEmail = false;
  let changingPassword = false;
  let deletingAccount = false;
  const accountButtons = [
    elements.editProfile,
    elements.changeEmail,
    elements.changePassword,
    elements.deleteAccount,
  ];

  function showStatus(element, message) {
    element.textContent = message;
  }

  function setProfileEditorOpen(open) {
    elements.profileForm.hidden = !open;
    elements.profileSummary.hidden = open;
    elements.editProfile.setAttribute("aria-expanded", String(open));
    if (open) showStatus(elements.profileStatus, "");
  }

  function readProfileValues() {
    return Object.fromEntries(PROFILE_FIELDS.map((field) => {
      const input = elements.profileForm.querySelector(`[data-student-field="${field}"]`);
      return [field, field === "date_of_birth" ? input.value : input.value.trim()];
    }));
  }

  function populateProfileForm() {
    PROFILE_FIELDS.forEach((field) => {
      const input = elements.profileForm.querySelector(`[data-student-field="${field}"]`);
      const value = profile[field];
      input.value = field === "date_of_birth" && value
        ? String(value).slice(0, 10)
        : value ?? "";
    });
    elements.photoInput.value = "";
  }

  async function renderProfilePhoto() {
    if (!profile.profile_photo_url) {
      elements.avatar.hidden = true;
      elements.avatar.removeAttribute("src");
      return;
    }

    let photoUrl = profile.profile_photo_url;
    if (!/^https?:\/\//i.test(photoUrl)) {
      const { data, error } = await client.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(photoUrl, 3600);
      if (error) throw error;
      photoUrl = data.signedUrl;
    }

    elements.avatar.alt = `${profile.full_name || "Student"}'s profile photo`;
    elements.avatar.src = photoUrl;
    elements.avatar.hidden = false;
    elements.avatar.addEventListener("error", () => {
      elements.avatar.hidden = true;
      showStatus(elements.accountStatus, "Your profile loaded, but the saved photo could not be displayed.");
    }, { once: true });
  }

  async function loadProfile() {
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    user = authData?.user;
    if (!user) {
      window.location.replace("../student_registration/login.html");
      return false;
    }

    const { data, error } = await client
      .from("students")
      .select(PROFILE_COLUMNS)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("No student profile is linked to this account.");
    profile = data;

    if (user.email && profile.email !== user.email) {
      const { data: synchronized, error: syncError } = await client
        .from("students")
        .update({ email: user.email })
        .eq("id", profile.id)
        .eq("user_id", user.id)
        .select(PROFILE_COLUMNS)
        .single();
      if (syncError) {
        console.error("[StudentSettings] Confirmed account email could not be synchronized to the student profile.", syncError);
      } else {
        profile = synchronized;
      }
    }

    elements.accountName.textContent = profile.full_name || "Student";
    elements.accountEmail.textContent = user.email || profile.email || "-";
    elements.accountPhone.textContent = profile.phone || "-";
    const grade = Number(profile.grade);
    const gradeLabel = Number.isInteger(grade) ? `Grade ${grade}` : "Grade not provided";
    const streamLabel = String(profile.stream || "").replace(/[_-]+/g, " ");
    const school = profile.school_name ? ` · ${profile.school_name}` : "";
    elements.accountDetails.textContent =
      `${profile.student_id || "Student"} · ${gradeLabel}${streamLabel ? ` · ${streamLabel}` : ""}${school}`;
    elements.emailStatus.textContent = `Current email: ${user.email || "-"}`;
    elements.emailCurrent.textContent = `Current email: ${user.email || "-"}`;
    populateProfileForm();
    await renderProfilePhoto();
    accountButtons.forEach((button) => {
      button.disabled = false;
    });
    return true;
  }

  function validatePhoto(file) {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      throw new Error("Choose a JPG, PNG, or GIF image.");
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error("The selected profile photo exceeds the 2 MB limit.");
    }
  }

  async function uploadPhoto(file) {
    validatePhoto(file);
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" }[file.type];
    const path = `${user.id}/profile-${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (savingProfile || !elements.profileForm.reportValidity()) return;
    if (!navigator.onLine) {
      showStatus(elements.profileStatus, "You are offline. Profile changes were not saved.");
      return;
    }

    const values = readProfileValues();
    const changes = Object.fromEntries(PROFILE_FIELDS
      .filter((field) => String(values[field] ?? "") !== String(profile[field] ?? ""))
      .map((field) => [field, values[field]]));
    const selectedPhoto = elements.photoInput.files?.[0] || null;
    if (!Object.keys(changes).length && !selectedPhoto) {
      showStatus(elements.profileStatus, "No profile changes to save.");
      return;
    }

    savingProfile = true;
    elements.saveProfile.disabled = true;
    elements.cancelProfile.disabled = true;
    showStatus(elements.profileStatus, "Saving profile...");
    let newPhotoPath = null;
    let profileSaved = false;
    const previousPhotoPath = profile.profile_photo_url;
    try {
      if (selectedPhoto) {
        newPhotoPath = await uploadPhoto(selectedPhoto);
        changes.profile_photo_url = newPhotoPath;
      }

      const { data, error } = await client
        .from("students")
        .update(changes)
        .eq("id", profile.id)
        .eq("user_id", user.id)
        .select(PROFILE_COLUMNS)
        .single();
      if (error) throw error;
      profile = data;
      profileSaved = true;
      elements.accountName.textContent = profile.full_name || "Student";
      elements.accountPhone.textContent = profile.phone || "-";
      elements.photoInput.value = "";
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      await renderProfilePhoto();
      setProfileEditorOpen(false);

      let message = "Profile saved successfully.";
      if (previousPhotoPath && previousPhotoPath !== profile.profile_photo_url) {
        const { error: removeError } = await client.storage
          .from(PHOTO_BUCKET)
          .remove([previousPhotoPath]);
        if (removeError) {
          console.error("[StudentSettings] The previous student profile photo could not be removed.", removeError);
          message = "Profile saved, but the previous photo could not be removed.";
        }
      }
      showStatus(elements.accountStatus, message);
    } catch (error) {
      console.error("[StudentSettings] Profile save failed.", error);
      if (newPhotoPath && !profileSaved) {
        const { error: cleanupError } = await client.storage.from(PHOTO_BUCKET).remove([newPhotoPath]);
        if (cleanupError) {
          console.error("[StudentSettings] Unlinked student profile photo cleanup failed.", cleanupError);
        }
      }
      showStatus(
        elements.profileStatus,
        navigator.onLine
          ? `Unable to save your profile: ${error.message || "Please try again."}`
          : "You are offline. Profile changes were not saved.",
      );
    } finally {
      savingProfile = false;
      elements.saveProfile.disabled = false;
      elements.cancelProfile.disabled = false;
    }
  }

  function settingsStorageKey() {
    return `smart-learning-student-settings:${user.id}`;
  }

  function loadSettings() {
    const stored = localStorage.getItem(settingsStorageKey());
    let warning = "";
    let values = {};
    if (stored) {
      try {
        values = JSON.parse(stored);
        if (!values || typeof values !== "object" || Array.isArray(values)) {
          throw new Error("Stored preferences are not a valid object.");
        }
      } catch (error) {
        console.error("[StudentSettings] Saved browser preferences could not be read.", error);
        values = {};
        warning = "Saved preferences could not be read. Defaults are shown; save to replace them.";
      }
    }

    const storedSettings = Object.fromEntries(
      Object.keys(DEFAULT_SETTINGS)
        .filter((key) => Object.prototype.hasOwnProperty.call(values, key))
        .map((key) => [key, values[key]]),
    );
    settings = { ...DEFAULT_SETTINGS, ...storedSettings };
    if (!["12h", "24h"].includes(settings.time_format)) settings.time_format = DEFAULT_SETTINGS.time_format;
    if (!["English", "Hindi", "Spanish", "French"].includes(settings.language)) settings.language = DEFAULT_SETTINGS.language;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone }).format(0);
    } catch {
      settings.timezone = DEFAULT_SETTINGS.timezone;
      warning ||= "The saved timezone was unavailable and has been reset to your browser timezone.";
    }
    savedSettings = { ...settings };
    renderSettings();
    showStatus(
      elements.settingsStatus,
      warning || "Preferences are saved in this browser for this student account.",
    );
  }

  function populateTimezones(selectedTimezone) {
    const timezones = typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["Asia/Kolkata", "UTC", "America/Los_Angeles", "America/New_York", "Europe/London"];
    if (selectedTimezone && !timezones.includes(selectedTimezone)) {
      timezones.unshift(selectedTimezone);
    }
    elements.timezone.replaceChildren();
    timezones.forEach((timezone) => {
      const option = document.createElement("option");
      option.value = timezone;
      option.textContent = timezone.replaceAll("_", " ");
      elements.timezone.append(option);
    });
  }

  function readSettings() {
    const values = { ...settings };
    document.querySelectorAll("[data-student-setting]").forEach((control) => {
      const key = control.dataset.studentSetting;
      if (control.type === "checkbox") values[key] = control.checked;
      else if (control.type === "radio") {
        if (control.checked) values[key] = control.value;
      } else values[key] = control.value;
    });
    return values;
  }

  function renderSettings() {
    populateTimezones(settings.timezone);
    document.querySelectorAll("[data-student-setting]").forEach((control) => {
      const value = settings[control.dataset.studentSetting];
      if (control.type === "checkbox") control.checked = Boolean(value);
      else if (control.type === "radio") control.checked = control.value === value;
      else if (Array.from(control.options).some((option) => option.value === String(value))) {
        control.value = String(value);
      }
    });
    window.TimezoneManager?.setCurrentTimezone(settings.timezone, "student-settings");
    updateSettingsSaveButton();
  }

  function updateSettingsSaveButton() {
    const dirty = JSON.stringify(readSettings()) !== JSON.stringify(savedSettings);
    elements.saveSettings.disabled = savingSettings || !dirty;
  }

  async function saveSettings() {
    if (savingSettings) return;
    const values = readSettings();
    if (!["12h", "24h"].includes(values.time_format)) {
      showStatus(elements.settingsStatus, "Choose a valid time format.");
      return;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: values.timezone }).format(0);
    } catch {
      showStatus(elements.settingsStatus, "Choose a valid timezone.");
      return;
    }

    savingSettings = true;
    elements.saveSettings.disabled = true;
    showStatus(elements.settingsStatus, "Saving preferences in this browser...");
    try {
      localStorage.setItem(settingsStorageKey(), JSON.stringify(values));
      settings = values;
      savedSettings = { ...values };
      window.TimezoneManager?.setCurrentTimezone(values.timezone, "student-settings");
      window.dispatchEvent(new CustomEvent("student-settings-updated", { detail: { ...values } }));
      showStatus(elements.settingsStatus, "Preferences saved in this browser for this student account.");
    } catch (error) {
      console.error("[StudentSettings] Browser preferences could not be saved.", error);
      showStatus(elements.settingsStatus, `Unable to save preferences: ${error.message || "browser storage is unavailable."}`);
    } finally {
      savingSettings = false;
      updateSettingsSaveButton();
    }
  }

  function openDialog(dialog, status) {
    showStatus(status, "");
    dialog.showModal();
  }

  async function requestEmailChange(event) {
    event.preventDefault();
    if (changingEmail) return;
    const nextEmail = elements.emailInput.value.trim();
    if (!elements.emailInput.reportValidity()) return;
    if (nextEmail.toLowerCase() === String(user.email || "").toLowerCase()) {
      showStatus(elements.emailStatusDialog, "Enter an email address different from your current email.");
      return;
    }
    changingEmail = true;
    elements.emailSubmit.disabled = true;
    showStatus(elements.emailStatusDialog, "Requesting email change...");
    try {
      const emailRedirectTo = new URL("../confirm-email-update.html", window.location.href).href;
      const { error } = await client.auth.updateUser({ email: nextEmail }, { emailRedirectTo });
      if (error) throw error;
      showStatus(elements.emailStatusDialog, "Email change requested. Check your new inbox and confirm the change before it appears here.");
    } catch (error) {
      showStatus(elements.emailStatusDialog, `Unable to request the email change: ${error.message || "Please try again."}`);
    } finally {
      changingEmail = false;
      elements.emailSubmit.disabled = false;
    }
  }

  function renderPasswordRequirements() {
    const validator = window.RegistrationPasswordValidation;
    if (!validator?.check) {
      showStatus(elements.passwordStatus, "Password validation is unavailable. Reload the page and try again.");
      elements.passwordSubmit.disabled = true;
      return;
    }
    const result = validator.check(elements.passwordInput.value);
    result.requirements.forEach((requirement) => {
      let item = elements.passwordRequirements.querySelector(
        `[data-password-requirement="${requirement.key}"]`,
      );
      if (!item) {
        item = document.createElement("li");
        item.dataset.passwordRequirement = requirement.key;
        item.textContent = requirement.label;
        elements.passwordRequirements.append(item);
      }
      item.classList.toggle("is-met", requirement.satisfied);
    });
    elements.passwordSubmit.disabled = !result.valid ||
      elements.passwordInput.value !== elements.passwordConfirm.value;
  }

  async function updatePassword(event) {
    event.preventDefault();
    if (changingPassword) return;
    const validator = window.RegistrationPasswordValidation;
    if (!validator?.check || !validator.check(elements.passwordInput.value).valid) {
      showStatus(elements.passwordStatus, "Password must meet all four requirements.");
      elements.passwordInput.focus();
      return;
    }
    if (!elements.passwordConfirm.value || elements.passwordInput.value !== elements.passwordConfirm.value) {
      showStatus(elements.passwordStatus, "The passwords do not match.");
      elements.passwordConfirm.focus();
      return;
    }
    changingPassword = true;
    elements.passwordSubmit.disabled = true;
    showStatus(elements.passwordStatus, "Updating password...");
    try {
      const { error } = await client.auth.updateUser({ password: elements.passwordInput.value });
      if (error) throw error;
      elements.passwordForm.reset();
      showStatus(elements.passwordStatus, "Password updated successfully.");
    } catch (error) {
      showStatus(elements.passwordStatus, `Unable to update password: ${error.message || "Please try again."}`);
    } finally {
      changingPassword = false;
      renderPasswordRequirements();
    }
  }

  async function deleteStudentAccount() {
    if (deletingAccount) return;
    if (!window.confirm(
      "Delete your student account permanently? This also deletes its linked student profile and cannot be undone.",
    )) return;
    deletingAccount = true;
    elements.deleteAccount.disabled = true;
    showStatus(elements.accountStatus, "Deleting your student account...");
    try {
      const { data, error } = await client.functions.invoke("delete-account", {
        body: { confirmation: "DELETE MY ACCOUNT" },
      });
      if (error) throw error;
      if (data?.deleted !== true) throw new Error("The account deletion was not confirmed.");
      if (data.studentProfilePhotoCleanupFailed === true) {
        console.error("[StudentSettings] Account deleted, but the profile photo could not be removed from storage.");
      }
      try {
        await client.auth.signOut();
      } catch (error) {
        console.warn("[StudentSettings] The deleted session could not be signed out.", error);
      }
      window.location.replace("../student_registration/login.html");
    } catch (error) {
      console.error("[StudentSettings] Student account deletion failed.", error);
      showStatus(elements.accountStatus, `Unable to delete your account: ${error.message || "Please contact support."}`);
      deletingAccount = false;
      elements.deleteAccount.disabled = false;
    }
  }

  function bindEvents() {
    elements.editProfile.addEventListener("click", () => {
      populateProfileForm();
      setProfileEditorOpen(true);
    });
    elements.cancelProfile.addEventListener("click", () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      populateProfileForm();
      setProfileEditorOpen(false);
      void renderProfilePhoto();
    });
    elements.photoInput.addEventListener("change", () => {
      const file = elements.photoInput.files?.[0];
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = file ? URL.createObjectURL(file) : null;
      if (previewUrl) {
        elements.avatar.src = previewUrl;
        elements.avatar.hidden = false;
      } else {
        void renderProfilePhoto();
      }
    });
    elements.profileForm.addEventListener("submit", (event) => void saveProfile(event));
    elements.saveSettings.addEventListener("click", () => void saveSettings());
    document.querySelectorAll("[data-student-setting]").forEach((control) => {
      control.addEventListener("change", updateSettingsSaveButton);
    });
    elements.changeEmail.addEventListener("click", () => openDialog(elements.emailDialog, elements.emailStatusDialog));
    elements.emailCancel.addEventListener("click", () => elements.emailDialog.close());
    elements.emailForm.addEventListener("submit", (event) => void requestEmailChange(event));
    elements.changePassword.addEventListener("click", () => openDialog(elements.passwordDialog, elements.passwordStatus));
    elements.passwordCancel.addEventListener("click", () => elements.passwordDialog.close());
    elements.passwordForm.addEventListener("submit", (event) => void updatePassword(event));
    elements.passwordInput.addEventListener("input", renderPasswordRequirements);
    elements.passwordConfirm.addEventListener("input", renderPasswordRequirements);
    elements.deleteAccount.addEventListener("click", () => void deleteStudentAccount());
  }

  async function initialize() {
    client = window.SmartLearningSupabase?.getClient?.();
    if (!client) throw new Error("Supabase is not configured.");
    accountButtons.forEach((button) => {
      button.disabled = true;
    });
    bindEvents();
    const loaded = await loadProfile();
    if (!loaded) return;
    loadSettings();
    renderPasswordRequirements();
    client.auth.onAuthStateChange((event, session) => {
      if (event === "USER_UPDATED" && session?.user) {
        user = session.user;
        elements.accountEmail.textContent = user.email || "-";
        elements.emailStatus.textContent = `Current email: ${user.email || "-"}`;
        elements.emailCurrent.textContent = `Current email: ${user.email || "-"}`;
      }
    });
  }

  initialize().catch((error) => {
    console.error("[StudentSettings] Initialization failed.", error);
    showStatus(elements.accountStatus, `Unable to load your student settings: ${error.message || "Please sign in again or try later."}`);
    accountButtons.forEach((button) => {
      button.disabled = true;
    });
  });
})();
