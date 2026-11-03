(() => {
  const TIMEZONE_CHANGE_EVENT = "app:timezonechange";
  const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function browserTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }

  function validateTimezone(timezone) {
    if (typeof timezone !== "string" || !timezone.trim()) return null;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
      return timezone;
    } catch {
      return null;
    }
  }

  let currentTimezone = browserTimezone();

  function setCurrentTimezone(timezone, source = "application") {
    currentTimezone = validateTimezone(timezone) || browserTimezone();
    window.dispatchEvent(new CustomEvent(TIMEZONE_CHANGE_EVENT, {
      detail: { timezone: currentTimezone, source },
    }));
    return currentTimezone;
  }

  window.addEventListener(TIMEZONE_CHANGE_EVENT, (event) => {
    const timezone = validateTimezone(event.detail?.timezone);
    currentTimezone = timezone || browserTimezone();
  });

  async function loadTeacherTimezone(client, expectedTeacherId) {
    if (!client?.auth?.getUser || !client?.from) {
      return setCurrentTimezone(null, "browser-fallback");
    }

    try {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData?.user?.id) {
        return setCurrentTimezone(null, "browser-fallback");
      }

      let profileQuery = client
        .from("teachers")
        .select("id")
        .eq("user_id", authData.user.id);
      if (expectedTeacherId) profileQuery = profileQuery.eq("id", expectedTeacherId);
      const { data: profile, error: profileError } = await profileQuery.maybeSingle();
      if (profileError || !profile?.id) {
        return setCurrentTimezone(null, "browser-fallback");
      }

      const { data: settings, error: settingsError } = await client
        .from("teacher_settings")
        .select("timezone")
        .eq("teacher_id", profile.id)
        .maybeSingle();
      if (settingsError) {
        console.warn("[TimezoneManager] Could not load the teacher timezone.", settingsError);
        return setCurrentTimezone(null, "browser-fallback");
      }
      return setCurrentTimezone(settings?.timezone, "teacher-settings");
    } catch (error) {
      console.warn("[TimezoneManager] Could not load the teacher timezone.", error);
      return setCurrentTimezone(null, "browser-fallback");
    }
  }

  async function getVisibleTimezones(client, resourceType, resourceIds) {
    if (!client?.rpc) throw new Error("Supabase is unavailable for event timezone lookup.");
    const supportedTypes = new Set([
      "calendar_events",
      "live_classes",
      "materials",
      "quizzes",
      "announcements",
    ]);
    if (!supportedTypes.has(resourceType)) {
      throw new Error("Unsupported student event resource type.");
    }

    const ids = [...new Set((Array.isArray(resourceIds) ? resourceIds : [])
      .filter((id) => typeof id === "string" && id.trim()))];
    const timezones = new Map();
    for (let offset = 0; offset < ids.length; offset += 1000) {
      const { data, error } = await client.rpc("get_student_visible_timezones", {
        requested_resource_type: resourceType,
        requested_resource_ids: ids.slice(offset, offset + 1000),
      });
      if (error) throw error;
      (Array.isArray(data) ? data : []).forEach((row) => {
        const timezone = validateTimezone(row?.timezone);
        if (row?.resource_id && timezone) {
          timezones.set(String(row.resource_id), timezone);
        }
      });
    }
    return timezones;
  }

  function requestedTimezone(timezone) {
    return validateTimezone(timezone) || currentTimezone || browserTimezone();
  }

  function parseDate(value, dateOnly = false) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value !== "string" || !value) return null;
    if (dateOnly || DATE_ONLY_PATTERN.test(value)) {
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return null;
      return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value, timezone = currentTimezone) {
    if (value === null || value === undefined || value === "") return "";
    const isDateOnly = typeof value === "string" && DATE_ONLY_PATTERN.test(value);
    const date = parseDate(value, isDateOnly);
    if (!date) return "";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: isDateOnly ? "UTC" : requestedTimezone(timezone),
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function formatWithOptions(value, options = {}, timezone = currentTimezone) {
    if (value === null || value === undefined || value === "") return "";
    const isDateOnly = typeof value === "string" && DATE_ONLY_PATTERN.test(value);
    const date = parseDate(value, isDateOnly);
    if (!date) return "";
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: isDateOnly ? "UTC" : requestedTimezone(timezone),
    }).format(date);
  }

  function formatTime(value, timezone = currentTimezone) {
    if (value === null || value === undefined || value === "" ||
        (typeof value === "string" && DATE_ONLY_PATTERN.test(value))) return "";
    const date = parseDate(value);
    if (!date) return "";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: requestedTimezone(timezone),
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function formatDateTime(value, timezone = currentTimezone) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "string" && DATE_ONLY_PATTERN.test(value)) return formatDate(value);
    const date = parseDate(value);
    if (!date) return "";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: requestedTimezone(timezone),
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function getCurrentDateTime(timezone = currentTimezone) {
    return formatDateTime(new Date(), timezone);
  }

  function convertToLocalTime(value, timezone = currentTimezone) {
    return formatDateTime(value, timezone);
  }

  window.TimezoneManager = Object.freeze({
    getCurrentTimezone: () => currentTimezone || browserTimezone(),
    formatDateTime,
    formatDate,
    formatWithOptions,
    formatTime,
    getCurrentDateTime,
    convertToLocalTime,
    loadTeacherTimezone,
    getVisibleTimezones,
    setCurrentTimezone,
    validateTimezone,
    TIMEZONE_CHANGE_EVENT,
  });
})();
