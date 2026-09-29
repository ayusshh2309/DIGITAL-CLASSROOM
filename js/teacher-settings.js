(() => {
  const statusElement = document.getElementById("settingsStatus");
  const saveButton = document.getElementById("saveSettingsButton");
  if (!statusElement || !saveButton) return;

  let client = null;
  let user = null;
  let profile = null;
  let settings = null;
  let settingsChannel = null;
  let profileChannel = null;
  let stopAuthWatch = null;
  let dirty = false;
  let saveTimer = null;
  let saving = false;

  const setStatus = (message) => {
    statusElement.textContent = message;
  };

  const setValue = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value || "-";
  };

  function renderSettings() {
    document.querySelectorAll("[data-setting]").forEach((control) => {
      const key = control.dataset.setting;
      if (control.type === "checkbox") {
        control.checked = Boolean(settings[key]);
      } else if (control.type === "radio") {
        control.checked = control.value === settings[key];
      } else {
        control.value = settings[key] ?? "";
      }
    });
  }

  async function renderAccount() {
    setValue("settingsTeacherName", profile.full_name);
    setValue("settingsTeacherEmail", user.email);
    setValue("settingsTeacherPhone", profile.phone_number);
    setValue(
      "settingsTeacherRole",
      profile.teaching_mode === "subject_specialist"
        ? "Teacher · Subject Specialist"
        : "Teacher · Educator",
    );
    const avatar = document.getElementById("settingsAvatar");
    if (!profile.profile_photo_url) {
      avatar.hidden = true;
      return;
    }
    try {
      avatar.src = await TeacherData.getTeacherProfilePhotoUrl(profile.profile_photo_url);
      avatar.hidden = false;
    } catch {
      avatar.hidden = true;
    }
  }

  function readSettings() {
    const values = {};
    document.querySelectorAll("[data-setting]").forEach((control) => {
      const key = control.dataset.setting;
      if (control.type === "checkbox") values[key] = control.checked;
      if (control.type === "radio" && control.checked) values[key] = control.value;
      if (control.tagName === "SELECT") values[key] = control.value;
    });
    return values;
  }

  function validateSettings(values) {
    if (!values.language || !values.timezone || !values.date_format) {
      setStatus("Choose a language, time zone, and date format.");
      return false;
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: values.timezone });
    } catch {
      setStatus("Choose a valid time zone.");
      return false;
    }
    if (!["12h", "24h"].includes(values.time_format)) {
      setStatus("Choose a valid time format.");
      return false;
    }
    if (!["Monday", "Sunday"].includes(values.week_start_day)) {
      setStatus("Choose Monday or Sunday as the week start.");
      return false;
    }
    return true;
  }

  async function saveSettings() {
    if (saving) return;
    if (!navigator.onLine) {
      setStatus("You are offline. Settings were not saved.");
      return;
    }
    const values = readSettings();
    if (!validateSettings(values)) return;

    saving = true;
    saveButton.disabled = true;
    setStatus("Saving...");
    try {
      settings = await TeacherData.updateCurrentTeacherSettings(values);
      dirty = false;
      setStatus("Settings saved successfully.");
    } catch (error) {
      console.error("Unable to save teacher settings.", error);
      setStatus(navigator.onLine
        ? "Unable to save settings. Please try again."
        : "You are offline. Settings were not saved.");
    } finally {
      saving = false;
      saveButton.disabled = false;
    }
  }

  async function changeEmail() {
    const email = window.prompt("Enter your new login email:");
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setStatus("Enter a valid email address.");
      return;
    }
    try {
      await TeacherData.updateAuthEmail(email.trim());
      setStatus("Check your inbox to confirm the email change.");
    } catch (error) {
      console.error("Unable to request email change.", error);
      setStatus("Unable to request the email change. Please try again.");
    }
  }

  async function changePassword() {
    const password = window.prompt("Enter a new password (at least 8 characters):");
    if (!password) return;
    if (password.length < 8) {
      setStatus("Use a password with at least 8 characters.");
      return;
    }
    const confirmation = window.prompt("Confirm your new password:");
    if (password !== confirmation) {
      setStatus("The passwords do not match.");
      return;
    }
    try {
      await TeacherData.updateAuthPassword(password);
      setStatus("Password updated successfully.");
    } catch (error) {
      console.error("Unable to update password.", error);
      setStatus("Unable to update your password. Please try again.");
    }
  }

  async function downloadTeacherData() {
    try {
      const current = await TeacherData.loadCurrentTeacherProfile();
      const currentSettings = await TeacherData.loadCurrentTeacherSettings();
      const exportData = {
        profile: current.profile,
        settings: currentSettings,
        exported_at: new Date().toISOString(),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "smart-learning-teacher-data.json";
      link.click();
      URL.revokeObjectURL(url);
      setStatus("Your profile and settings export has been downloaded.");
    } catch (error) {
      console.error("Unable to export teacher data.", error);
      setStatus("Unable to export your data. Please try again.");
    }
  }

  async function deleteAccount() {
    if (!window.confirm("Delete your account and associated profile? This action is permanent.")) return;
    const confirmation = window.prompt('Type DELETE MY ACCOUNT to confirm:');
    if (confirmation !== "DELETE MY ACCOUNT") {
      setStatus("Account deletion was cancelled.");
      return;
    }
    try {
      const { error } = await client.functions.invoke("delete-account", {
        body: { confirmation },
      });
      if (error) throw error;
      await client.auth.signOut();
      window.location.assign("../teacher_registration/login.html");
    } catch (error) {
      console.error("Unable to delete teacher account.", error);
      setStatus("Account deletion is unavailable until the secure delete-account function is deployed.");
    }
  }

  document.querySelectorAll("[data-setting]").forEach((control) => {
    control.addEventListener("change", () => {
      dirty = true;
      const values = readSettings();
      if (control.dataset.setting === "auto_save" || values.auto_save) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveSettings, 500);
      } else {
        setStatus("Unsaved changes.");
      }
    });
  });

  saveButton.addEventListener("click", saveSettings);
  document.querySelectorAll("[data-action]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      switch (link.dataset.action) {
        case "change-email": changeEmail(); break;
        case "change-password": changePassword(); break;
        case "download-data": downloadTeacherData(); break;
        case "devices": setStatus("Connected-device inventory is not available in this application."); break;
        case "delete-account": deleteAccount(); break;
      }
    });
  });

  window.addEventListener("beforeunload", () => {
    clearTimeout(saveTimer);
    if (client && settingsChannel) client.removeChannel(settingsChannel);
    if (client && profileChannel) client.removeChannel(profileChannel);
    stopAuthWatch?.();
  });

  async function initialize() {
    setStatus("Loading settings...");
    const loaded = await TeacherData.loadCurrentTeacherProfile();
    client = loaded.client;
    user = loaded.user;
    profile = loaded.profile;
    settings = await TeacherData.loadCurrentTeacherSettings();
    await renderAccount();
    renderSettings();
    setStatus("");

    profileChannel = TeacherData.subscribeToTeacherProfile(user.id, (event) => {
      if (event.eventType === "DELETE") {
        void TeacherData.handleUnavailableTeacher(client);
        return;
      }
      if (event.new) {
        profile = event.new;
        renderAccount();
      }
    });
    settingsChannel = TeacherData.subscribeToTeacherSettings(profile.id, (event) => {
      if (!event.new || dirty) {
        if (dirty) setStatus("Settings changed on another device. Save to keep your edits.");
        return;
      }
      settings = event.new;
      renderSettings();
      setStatus("Settings updated from another session.");
    });
    stopAuthWatch = TeacherData.watchAuthState(() => {
      window.location.assign("../teacher_registration/login.html");
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initialize().catch((error) => {
      console.error("Unable to load teacher settings.", error);
      setStatus("Unable to load your settings. Please sign in again or try later.");
      const saveControl = document.getElementById("saveSettingsButton");
      if (saveControl) saveControl.disabled = true;
    });
  });
})();
