(() => {
  const PAGE_SIZE = 1000;
  const STUDY_SESSION_STATUSES = new Set(["active", "completed", "abandoned", "paused"]);
  const STREAK_THRESHOLD_SECONDS = 30 * 60;
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  const state = { client: null, user: null, studentId: null, definitions: [], unlocked: [], metrics: null, materialCompletions: null, progressErrors: [], loaded: false };

  function setStatus(message, isError = false) {
    if (isError && !state.loaded) renderAchievementProgressError(message);
    const status = $("achievementStatus");
    if (!status) return;
    status.textContent = message || "";
    status.hidden = !message;
    status.setAttribute("role", isError ? "alert" : "status");
    status.style.color = isError ? "#b83d4b" : "";
  }

  function setGridMessage(message, isError = false) {
    const grid = $("badgesGrid");
    if (!grid) return;
    grid.innerHTML = `<p class="empty-state"${isError ? ' role="alert"' : ' role="status"'}>${escapeHtml(message)}</p>`;
  }

  function setRecentMessage(message, type = "loading") {
    const recent = $("recentAchievements");
    if (!recent) return;
    const icons = {
      loading: "fa-spinner fa-spin",
      empty: "fa-award",
      error: "fa-triangle-exclamation",
    };
    recent.innerHTML = `<div class="recent-state recent-state-${type}" role="${type === "error" ? "alert" : "status"}"><span class="recent-state-icon"><i class="fa-solid ${icons[type] || icons.empty}" aria-hidden="true"></i></span><span>${escapeHtml(message)}</span></div>`;
  }

  function renderRegistrationContext(student) {
    const context = $("registrationContext");
    const text = $("registrationContextText");
    if (!context || !text || !student?.grade) return;

    const grade = Number(student.grade);
    const stream = String(student.stream || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const streamLabels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts: "Arts / Humanities",
      arts_humanities: "Arts / Humanities",
    };
    const streamText = grade >= 11
      ? ` - ${streamLabels[stream] || stream.replace(/_/g, " ")}`
      : "";

    text.textContent = `Grade ${grade}${streamText}`;
    context.hidden = false;
  }

  function dateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  async function readAllRows(createQuery) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await createQuery().range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      if (!Array.isArray(data)) {
        throw new Error("An achievement data query returned an invalid response.");
      }
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  function calculateStreak(dailyStudySeconds) {
    const days = [...dailyStudySeconds.entries()]
      .filter(([, seconds]) => seconds >= STREAK_THRESHOLD_SECONDS)
      .map(([day]) => day)
      .sort()
      .reverse();
    if (!days.length) return { current: 0, best: 0 };
    const dayNumber = (key) => Date.parse(`${key}T00:00:00`);
    let best = 1;
    let run = 1;
    for (let index = 1; index < days.length; index += 1) {
      if (dayNumber(days[index - 1]) - dayNumber(days[index]) === 86400000) { run += 1; best = Math.max(best, run); } else run = 1;
    }
    const today = dateKey(new Date());
    const yesterday = dateKey(Date.now() - 86400000);
    let current = days[0] === today || days[0] === yesterday ? 1 : 0;
    for (let index = 1; current && index < days.length; index += 1) {
      if (dayNumber(days[index - 1]) - dayNumber(days[index]) === 86400000) current += 1; else break;
    }
    return { current, best: Math.max(best, current) };
  }

  function addDailyStudySeconds(totals, segment, durationSeconds) {
    let cursor = new Date(segment.started_at);
    const end = segment.ended_at
      ? new Date(segment.ended_at)
      : new Date(cursor.getTime() + durationSeconds * 1000);
    if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime()) || end <= cursor) return false;
    const intervalMilliseconds = end.getTime() - cursor.getTime();
    while (cursor < end) {
      const day = dateKey(cursor);
      if (!day) return false;
      const nextMidnight = Date.parse(`${day}T00:00:00Z`) - 19800000 + 86400000;
      const intervalEnd = Math.min(nextMidnight, end.getTime());
      const seconds = durationSeconds * (intervalEnd - cursor.getTime()) / intervalMilliseconds;
      totals.set(day, (totals.get(day) || 0) + seconds);
      cursor = new Date(intervalEnd);
    }
    return true;
  }

  function metricsFrom(rows) {
    const metrics = {
      completedSessions: null,
      sessionsToday: null,
      weeklyStudyMinutes: null,
      studyStreak: null,
      bestStreak: null,
      highScoreQuizzes: null,
      perfectScoreQuizzes: null,
      submittedQuizzes: null,
      totalStudyMinutes: null,
      distinctSubjects: null,
      completedResources: null,
      challengesCompleted: 0,
      rankingPosition: null,
    };

    if (rows.quizAttempts) {
      const attempts = rows.quizAttempts;
      metrics.submittedQuizzes = attempts.length;
      metrics.highScoreQuizzes = attempts.filter((attempt) => Number(attempt.percentage) >= 90).length;
      metrics.perfectScoreQuizzes = attempts.filter((attempt) => Number(attempt.percentage) >= 100).length;
      metrics.distinctSubjects = new Set(attempts
        .map((attempt) => Array.isArray(attempt.quiz) ? attempt.quiz[0]?.subject_id : attempt.quiz?.subject_id)
        .filter((subjectId) => subjectId != null)
        .map(String)).size;
    }

    if (rows.sessions) {
      metrics.completedSessions = rows.sessions.filter((session) => session.status === "completed").length;
    }
    if (!rows.sessions || !rows.segments) return metrics;

    const sessionsById = new Map(rows.sessions.map((session) => [String(session.id), session]));
    const completedStudySessions = new Set();
    const sessionsByDay = new Map();
    const dailyStudySeconds = new Map();
    const currentWeek = Date.now() - 7 * 86400000;
    let weeklyStudySeconds = 0;
    let totalStudySeconds = 0;

    for (const segment of rows.segments) {
      const session = sessionsById.get(String(segment.session_id));
      const duration = Number(segment.duration_seconds);
      if (
        !session ||
        !STUDY_SESSION_STATUSES.has(String(session.status || "").toLowerCase()) ||
        !Number.isFinite(duration) ||
        duration <= 0
      ) continue;

      const sessionId = String(session.id);
      if (!addDailyStudySeconds(dailyStudySeconds, segment, duration)) continue;
      const endedAt = new Date(segment.ended_at);
      if (session.status === "completed") completedStudySessions.add(sessionId);
      totalStudySeconds += duration;
      const lastDay = dateKey(endedAt);
      const daySessions = sessionsByDay.get(lastDay) || new Set();
      daySessions.add(sessionId);
      sessionsByDay.set(lastDay, daySessions);
      if (endedAt.getTime() >= currentWeek) weeklyStudySeconds += duration;
    }

    const streak = calculateStreak(dailyStudySeconds);
    metrics.completedSessions = Math.max(metrics.completedSessions || 0, completedStudySessions.size);
    metrics.sessionsToday = sessionsByDay.get(dateKey(new Date()))?.size || 0;
    metrics.weeklyStudyMinutes = weeklyStudySeconds / 60;
    metrics.totalStudyMinutes = totalStudySeconds / 60;
    metrics.studyStreak = streak.current;
    metrics.bestStreak = streak.best;
    return metrics;
  }

  function metricValue(definition) {
    const metrics = state.metrics || {};
    const title = String(definition.title || "").trim().toLowerCase();
    if (title.includes("knowledge seeker")) {
      return state.materialCompletions?.size ?? null;
    }
    if (title.includes("bookworm") || title.includes("material") || title.includes("resource")) return null;
    if (title.includes("subject explorer")) return metrics.distinctSubjects;
    if (title.includes("perfect score")) return metrics.perfectScoreQuizzes;
    if (title.includes("top performer")) return metrics.highScoreQuizzes;
    if (title.includes("streak")) return metrics.studyStreak;
    if (title.includes("quiz master")) return metrics.submittedQuizzes;
    if (title.includes("high score")) return metrics.highScoreQuizzes;
    if (title.includes("quiz")) return metrics.submittedQuizzes;
    if (title.includes("first hour") || title.includes("dedicated learner") || title.includes("study champion")) {
      return metrics.totalStudyMinutes;
    }
    if (title.includes("time champion") || title.includes("study time") || title.includes("weekly")) {
      return metrics.weeklyStudyMinutes;
    }
    if (title.includes("quick learner")) return metrics.sessionsToday;
    if (title.includes("session") || title.includes("first step")) return metrics.completedSessions;
    return null;
  }

  function nextAchievementProgress(definition) {
    const rawCurrent = metricValue(definition);
    if (!Number.isFinite(rawCurrent)) return null;
    const title = String(definition.title || "").toLowerCase();
    const requirement = Number(definition.requirement_value);
    if (!Number.isFinite(requirement) || requirement <= 0) return null;

    let current = rawCurrent;
    let target = requirement;
    let unit = "milestones";
    if (title.includes("knowledge seeker")) {
      unit = "materials";
    } else if (title.includes("streak")) {
      unit = "days";
    } else if (title.includes("first hour") || title.includes("dedicated learner") ||
      title.includes("study champion") || title.includes("time champion") ||
      title.includes("study time") || title.includes("weekly")) {
      current = rawCurrent / 60;
      target = requirement >= 60 ? requirement / 60 : requirement;
      unit = "hours";
    } else if (title.includes("subject explorer")) {
      unit = "subjects";
    } else if (title.includes("quiz")) {
      unit = "quizzes";
    } else if (title.includes("session")) {
      unit = "sessions";
    }

    current = Math.min(current, target);
    return {
      current,
      target,
      ratio: Math.max(0, Math.min(1, current / target)),
      unit,
    };
  }

  function displayProgressNumber(value) {
    if (!Number.isFinite(value)) return "0";
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(3).replace(/\.?0+$/, "");
  }

  function renderNextAchievement() {
    const panel = $("nextAchievementPanel");
    const completePanel = $("nextAchievementComplete");
    const milestones = $("nextMilestones");
    if (!state.definitions.length) {
      panel.hidden = false;
      completePanel.classList.remove("is-visible");
      $("nextAchievementName").textContent = "Finding your next milestone…";
      $("nextAchievementDescription").textContent = "Your progress will appear here.";
      $("nextProgressLabel").textContent = "—";
      $("nextRemainingLabel").textContent = "Loading progress…";
      return;
    }
    const locked = state.definitions.filter((definition) => !unlockedFor(definition));
    if (!locked.length && state.definitions.length) {
      panel.hidden = true;
      completePanel.classList.add("is-visible");
      return;
    }

    completePanel.classList.remove("is-visible");
    panel.hidden = false;
    const candidates = locked
      .map((definition) => ({ definition, progress: nextAchievementProgress(definition) }))
      .filter((entry) => entry.progress)
      .sort((a, b) => {
        const aStarted = a.progress.current > 0;
        const bStarted = b.progress.current > 0;
        if (aStarted !== bStarted) return aStarted ? -1 : 1;
        return b.progress.ratio - a.progress.ratio;
      });
    const selected = candidates[0] || { definition: locked[0], progress: null };
    const { definition, progress } = selected;

    $("nextAchievementName").textContent = definition.title;
    $("nextAchievementDescription").textContent = progress
      ? definition.description
      : /knowledge seeker|bookworm|material|resource/i.test(definition.title)
        ? "Completion tracking is not implemented yet."
        : "Progress is currently unavailable.";
    $("nextAchievementIcon").innerHTML = achievementIllustration(definition).svg;
    $("nextAchievementIcon").setAttribute("aria-label", `${definition.title} badge illustration`);

    const requirement = Number(definition.requirement_value) || 0;
    if (!progress) {
      $("nextProgressLabel").textContent = "Unavailable";
      $("nextRemainingLabel").textContent = "Progress unavailable";
      milestones.querySelectorAll(".next-milestone").forEach((milestone) => {
        milestone.classList.remove("complete");
        milestone.querySelector(".next-milestone-fill").style.width = "0%";
      });
      milestones.setAttribute("aria-label", "Achievement progress is unavailable");
      return;
    }

    const currentText = displayProgressNumber(progress.current);
    const targetText = displayProgressNumber(progress.target);
    const remaining = Math.max(0, progress.target - progress.current);
    const remainingUnit = remaining === 1
      ? progress.unit.replace(/s$/, "")
      : progress.unit;
    $("nextProgressLabel").textContent = `${currentText} / ${targetText} ${progress.unit}`;
    $("nextRemainingLabel").textContent = remaining > 0
      ? `${displayProgressNumber(remaining)} more ${remainingUnit} to go`
      : "Milestone reached";
    const steps = [...milestones.querySelectorAll(".next-milestone")];
    steps.forEach((step, index) => {
      const stepProgress = Math.max(0, Math.min(1, progress.ratio * steps.length - index));
      step.classList.toggle("complete", stepProgress >= 1);
      step.querySelector(".next-milestone-fill").style.width = `${Math.round(stepProgress * 100)}%`;
    });
    milestones.setAttribute(
      "aria-label",
      `${currentText} of ${targetText} ${progress.unit} completed`,
    );
    const achievementId = String(definition.id);
    if (panel.dataset.achievementId && panel.dataset.achievementId !== achievementId) {
      panel.classList.remove("is-changing");
      void panel.offsetWidth;
      panel.classList.add("is-changing");
      window.setTimeout(() => panel.classList.remove("is-changing"), 400);
    }
    panel.dataset.achievementId = achievementId;
  }

  async function loadOptionalRows(label, query) {
    try {
      return await query();
    } catch (error) {
      console.error(`Could not load ${label} for achievement progress.`, error);
      return null;
    }
  }

  async function loadUnlockedAchievements() {
    const queryForStudent = (studentId) => readAllRows(() => state.client.from("student_achievements")
      .select("achievement_id,unlocked_at,xp_earned,achievement_definition:achievement_definitions(id,title,description,icon,category,requirement_value,xp_reward,is_active)")
      .eq("student_id", studentId)
      .order("unlocked_at", { ascending: false })
      .order("achievement_id", { ascending: true }));
    const authUserAchievements = await queryForStudent(state.user.id);
    if (authUserAchievements.length || String(state.studentId) === String(state.user.id)) {
      return authUserAchievements;
    }

    const profileAchievements = await queryForStudent(state.studentId);
    if (profileAchievements.length) {
      console.info("Loaded student achievements using the linked student profile.");
    }
    return profileAchievements;
  }

  async function loadRows() {
    const [quizAttempts, sessions, definitions, unlocked, materialCompletions] = await Promise.all([
      loadOptionalRows("submitted quiz attempts", () => readAllRows(() => state.client.from("quiz_attempts")
        .select("id,quiz_id,percentage,submitted_at,quiz:quizzes(subject_id)")
        .eq("student_id", state.studentId)
        .eq("status", "submitted")
        .order("submitted_at", { ascending: true }))),
      loadOptionalRows("study sessions", () => readAllRows(() => state.client.from("study_sessions")
        .select("id,status")
        .eq("student_id", state.studentId)
        .order("id", { ascending: true }))),
      readAllRows(() => state.client.from("achievement_definitions")
        .select("id,title,description,icon,category,requirement_value,xp_reward,is_active,created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: true })),
      loadUnlockedAchievements(),
      loadOptionalRows("completed learning materials", () => readAllRows(() => state.client
        .from("student_material_completions")
        .select("material_id")
        .eq("student_id", state.studentId)
        .order("completed_at", { ascending: true }))),
    ]);
    let segments = null;
    if (sessions) {
      segments = await loadOptionalRows("study-session segments", async () => {
        const sessionIds = sessions.map((session) => String(session.id));
        const rows = [];
        for (let index = 0; index < sessionIds.length; index += 100) {
          const batch = sessionIds.slice(index, index + 100);
          rows.push(...await readAllRows(() => state.client
            .from("study_session_segments")
            .select("id,session_id,started_at,ended_at,duration_seconds")
            .in("session_id", batch)
            .order("id", { ascending: true })));
        }
        return rows;
      });
    }
    return {
      sessions,
      segments,
      quizAttempts,
      definitions,
      unlocked,
      materialCompletions,
      progressErrors: [
        ...(!quizAttempts ? ["submitted quiz attempts"] : []),
        ...(!sessions ? ["study sessions"] : []),
        ...(sessions && !segments ? ["study-session segments"] : []),
        ...(!materialCompletions ? ["completed learning materials"] : []),
      ],
    };
  }

  async function refreshAchievements() {
    if (!state.client || !state.user) return;
    const rows = await loadRows();
    state.metrics = metricsFrom(rows);
    state.progressErrors = rows.progressErrors;
    state.definitions = rows.definitions;
    state.materialCompletions = rows.materialCompletions
      ? new Set(rows.materialCompletions.map((completion) => String(completion.material_id)))
      : null;
    state.unlocked = rows.unlocked.map((item) => ({
      ...item,
      definition: (Array.isArray(item.achievement_definition)
        ? item.achievement_definition[0]
        : item.achievement_definition) ||
        rows.definitions.find((definition) => String(definition.id) === String(item.achievement_id)) ||
        null,
    }));
    state.loaded = true;
    render();
  }

  async function evaluateStudentAchievements() {
    const { data, error } = await state.client.rpc("evaluate_student_achievements_v1");
    if (error) throw error;
    console.info("Student achievements evaluated.", { result: data });
  }

  function unlockedFor(definition) {
    return state.unlocked.find((item) => String(item.achievement_id) === String(definition.id));
  }
  function percent(value, total) { return total ? Math.min(100, Math.round(value / total * 100)) : 0; }

  function achievementIllustration(definition) {
    const title = String(definition.title || "").toLowerCase();
    const id = String(definition.id || "achievement").replace(/[^a-zA-Z0-9_-]/g, "") || "achievement";
    let type = "trophy";
    let art = '<path d="M33 25h30v15c0 12-7 20-15 20s-15-8-15-20V25Z" fill="url(#gold-' + id + ')" stroke="#b87415" stroke-width="2.5"/><path d="M33 31H22v8c0 9 6 14 15 14M63 31h11v8c0 9-6 14-15 14" fill="none" stroke="#dc9b2b" stroke-width="5" stroke-linecap="round"/><path d="M48 60v10m-11 5h22m-19-5h16" stroke="#a66b23" stroke-width="4" stroke-linecap="round"/><path d="m48 31 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L48 31Z" fill="#fff7d1"/>';
    if (/perfect|diamond/.test(title)) {
      type = "diamond";
      art = '<path d="m48 16 24 12-8 39H32l-8-39 24-12Z" fill="url(#blue-' + id + ')" stroke="#2563b8" stroke-width="2.5" stroke-linejoin="round"/><path d="m24 28 16 2 8-14 8 14 16-2M40 30 32 67m16-37 0 37m8-37 8 37M24 28l24 39 24-39" fill="none" stroke="#e5f7ff" stroke-width="2.4" stroke-linejoin="round"/><path d="m36 24 5-7m22 13 5-3" stroke="#fff" stroke-width="3" stroke-linecap="round"/>';
    } else if (/quiz master|owl/.test(title)) {
      type = "owl";
      art = '<path d="m30 30 3-13 13 8 13-8 7 15v20c0 14-8 22-18 22S30 66 30 52V30Z" fill="url(#purple-' + id + ')" stroke="#6042a9" stroke-width="2.5"/><path d="m30 27-9-8 2 18 10 5m33-15 9-8-2 18-10 5" fill="#8f6add" stroke="#6042a9" stroke-width="2.5" stroke-linejoin="round"/><path d="m30 25 18-10 18 10-18 5-18-5Zm18-1v-9" fill="#f3b832" stroke="#9e6d13" stroke-width="2.2" stroke-linejoin="round"/><circle cx="40" cy="43" r="8" fill="#fff"/><circle cx="56" cy="43" r="8" fill="#fff"/><circle cx="41" cy="44" r="3.5" fill="#28324a"/><circle cx="55" cy="44" r="3.5" fill="#28324a"/><path d="m48 49-5 7h10l-5-7Z" fill="#f18b30"/>';
    } else if (/top performer|medal|study champion/.test(title)) {
      type = /study champion/.test(title) ? "laurel" : "medal";
      art = '<path d="m34 18 14 16 14-16 7 34H27l7-34Z" fill="url(#purple-' + id + ')" stroke="#6846bd" stroke-width="2.5" stroke-linejoin="round"/><circle cx="48" cy="53" r="22" fill="url(#gold-' + id + ')" stroke="#bd841f" stroke-width="2.5"/><circle cx="48" cy="53" r="16" fill="#fff3c4" stroke="#fff" stroke-width="2"/><path d="m48 40 4 8 9 1.3-6.5 6.3 1.5 9L48 60l-8 4.6 1.5-9-6.5-6.3 9-1.3 4-8Z" fill="#e7a327"/><path d="M25 67c-7 2-10 8-10 14 8 0 14-3 17-9m39-5c7 2 10 8 10 14-8 0-14-3-17-9" fill="none" stroke="#2d9d70" stroke-width="4" stroke-linecap="round"/>';
    } else if (/hour|first hour/.test(title)) {
      type = "hourglass";
      art = '<path d="M31 19h34M31 77h34M35 21c0 12 4 18 13 27-9 9-13 15-13 27m26-54c0 12-4 18-13 27 9 9 13 15 13 27" fill="#e9f2ff" stroke="#3976b8" stroke-width="3" stroke-linecap="round"/><path d="M38 26h20c-1 8-4 12-10 17-6-5-9-9-10-17Zm0 44h20c-1-8-4-12-10-17-6 5-9 9-10 17Z" fill="url(#gold-' + id + ')"/><path d="M46 49h4m-2-2v5" stroke="#dc941d" stroke-width="3" stroke-linecap="round"/><circle cx="69" cy="29" r="4" fill="#ffd66b"/>';
    } else if (/dedicated learner|bookworm|book/.test(title)) {
      type = "book";
      art = '<path d="M17 29c12-5 22-3 31 4v43c-9-7-19-9-31-4V29Zm62 0c-12-5-22-3-31 4v43c9-7 19-9 31-4V29Z" fill="url(#blue-' + id + ')" stroke="#3766b0" stroke-width="2.5" stroke-linejoin="round"/><path d="M48 34v42M25 39c7-2 13-1 18 2m28-2c-7-2-13-1-18 2" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="48" cy="22" r="11" fill="url(#gold-' + id + ')" stroke="#d6931e" stroke-width="2"/><path d="m48 15 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7L48 15Z" fill="#fff8d6"/>';
    } else if (/3.day|three.day|streak/.test(title) && /30.day|month/.test(title)) {
      type = "calendar-sun";
      art = '<rect x="20" y="24" width="56" height="51" rx="8" fill="#fff" stroke="#4777c7" stroke-width="3"/><path d="M20 38h56" stroke="#4777c7" stroke-width="7"/><path d="M33 18v12m30-12v12" stroke="#f08a4b" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="55" r="11" fill="url(#gold-' + id + ')"/><path d="M50 39v-4m0 40v-4m16-16h4m-40 0h4m27-11 3-3m-28 28 3-3m22 0 3 3m-28-28 3 3" stroke="#e59c24" stroke-width="3" stroke-linecap="round"/><path d="m43 58 5 5 10-11" fill="none" stroke="#438d64" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
    } else if (/7.day|seven.day/.test(title)) {
      type = "calendar-flame";
      art = '<rect x="20" y="24" width="56" height="51" rx="8" fill="#fff" stroke="#4777c7" stroke-width="3"/><path d="M20 38h56" stroke="#4777c7" stroke-width="7"/><path d="M33 18v12m30-12v12" stroke="#f08a4b" stroke-width="5" stroke-linecap="round"/><path d="M49 68c-10 0-15-7-12-15 1-4 5-7 6-13 6 4 8 9 8 13 3-3 4-6 4-9 8 7 11 15 7 20-3 3-7 4-13 4Z" fill="url(#orange-' + id + ')" stroke="#dc7131" stroke-width="2"/><path d="M49 64c-4-3-3-7 1-11 3 5 5 8 1 11Z" fill="#fff3b0"/>';
    } else if (/3.day|three.day/.test(title)) {
      type = "calendar-flame";
      art = '<rect x="20" y="25" width="56" height="50" rx="8" fill="#fff" stroke="#c58b27" stroke-width="3"/><path d="M20 39h56" stroke="#e1ae48" stroke-width="7"/><path d="M33 19v12m30-12v12" stroke="#bb7a22" stroke-width="5" stroke-linecap="round"/><text x="48" y="63" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="800" fill="#a96b1c">3</text><path d="M49 37c-5-7-1-12 4-18 0 6 6 8 8 14 3 8-3 15-11 15-7 0-12-5-10-12 1-4 4-6 4-10 4 3 5 7 5 11Z" fill="url(#orange-' + id + ')" stroke="#d96c31" stroke-width="1.8"/><path d="M50 43c-2-3 0-6 3-8 2 3 3 6 0 8Z" fill="#fff3b0"/>';
    } else if (/subject explorer|compass/.test(title)) {
      type = "compass";
      art = '<circle cx="48" cy="48" r="31" fill="url(#blue-' + id + ')" stroke="#3767a7" stroke-width="3"/><circle cx="48" cy="48" r="23" fill="#f8fcff" stroke="#9fc6e5" stroke-width="2"/><path d="m57 36-6 17-17 7 6-17 17-7Z" fill="#ed6b55" stroke="#b94a45" stroke-width="2" stroke-linejoin="round"/><circle cx="48" cy="48" r="3.5" fill="#f5bd46"/><path d="m25 25 4 4m38 38 4 4m0-46-4 4m-38 38-4 4" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="70" cy="27" r="5" fill="#f5bd46"/>';
    } else if (/knowledge seeker|bookshelf|library/.test(title)) {
      type = "bookshelf";
      art = '<path d="M20 24h56v49H20z" fill="#fff7e6" stroke="#93602d" stroke-width="3"/><path d="M20 47h56M20 73h56" stroke="#93602d" stroke-width="4"/><path d="M26 29h9v16h-9zm12-3h10v19H38zm13 5h8v14h-8zm12-4h8v18h-8zM27 51h8v18h-8zm11 3h10v15H38zm13-5h9v20h-9zm12 4h8v16h-8z" fill="#7961d4"/><path d="M26 29h9v16h-9zm25 2h8v14h-8zm11 20h8v16h-8z" fill="#ef8164"/><path d="M47 19c0-5 4-8 8-8s8 3 8 8c0 3-2 5-4 7H51c-2-2-4-4-4-7Zm5 10h8m-7 4h6" fill="#ffd45c" stroke="#d79c32" stroke-width="2" stroke-linecap="round"/>';
    }

    const tone = {
      trophy: "gold",
      diamond: "blue",
      owl: "purple",
      medal: "purple",
      laurel: "green",
      hourglass: "gold",
      book: "blue",
      "calendar-sun": "gold",
      "calendar-flame": "orange",
      flames: "orange",
      compass: "blue",
      bookshelf: "green",
    }[type] || "purple";
    return {
      type,
      tone,
      svg: `<svg class="achievement-illustration illustration-${type}" viewBox="0 0 96 96" role="img" aria-label="${escapeHtml(definition.title)} illustration" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gold-${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffe17a"/><stop offset="1" stop-color="#e79a24"/></linearGradient><linearGradient id="blue-${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#77dcff"/><stop offset="1" stop-color="#5484e8"/></linearGradient><linearGradient id="purple-${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#bca7ff"/><stop offset="1" stop-color="#7654d9"/></linearGradient><linearGradient id="orange-${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffd76e"/><stop offset="1" stop-color="#f07b35"/></linearGradient><linearGradient id="red-${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff9a68"/><stop offset="1" stop-color="#e84f59"/></linearGradient></defs><circle class="illustration-halo" cx="48" cy="48" r="44"/><g class="illustration-art">${art}</g></svg>`,
    };
  }

  function relativeDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Date unavailable";
    const days = (Date.parse(`${dateKey(new Date())}T00:00:00Z`) -
      Date.parse(`${dateKey(date)}T00:00:00Z`)) / 86400000;
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    return date.toLocaleDateString("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function formatUnlockDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Date unavailable";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function renderBadges() {
    const grid = $("badgesGrid");
    if (!grid) return;
    $("badgesCard").style.display = "";
    if (!state.definitions.length) {
      grid.innerHTML = '<p class="empty-state">No achievements are available yet.</p>';
      return;
    }
    grid.innerHTML = state.definitions.map((definition) => {
      const unlock = unlockedFor(definition);
      const earned = Boolean(unlock);
      const requirement = Number(definition.requirement_value) || 0;
      const metric = metricValue(definition);
      const available = Number.isFinite(metric);
      const current = available ? Math.min(metric, requirement) : 0;
      const progress = available ? percent(current, requirement) : 0;
      const xp = Number(definition.xp_reward) || 0;
      const currentText = displayProgressNumber(current);
      const requirementText = displayProgressNumber(requirement);
      const remaining = displayProgressNumber(Math.max(0, requirement - current));
      const isKnowledgeSeeker = String(definition.title || "").toLowerCase().includes("knowledge seeker");
      const progressText = !available
        ? "Progress unavailable"
        : `${currentText} / ${requirementText}`;
      const unlockText = earned
        ? `Unlocked ${formatUnlockDate(unlock.unlocked_at)}`
        : available
          ? `${remaining}${isKnowledgeSeeker ? " materials remaining" : " remaining"}`
          : progressText;
      const illustration = achievementIllustration(definition);
      return `<article class="badge-card ${earned ? "earned" : "locked"}" data-tone="${illustration.tone}" data-status="${earned ? "earned" : "locked"}" data-achievement-id="${escapeHtml(definition.id)}"><div class="badge-illustration">${illustration.svg}</div><h3>${escapeHtml(definition.title)}</h3><p class="badge-description">${escapeHtml(definition.description)}</p><div class="badge-progress"><div class="next-progress-bar"><div class="next-progress-fill" style="width:${earned ? 100 : progress}%"></div></div><div class="next-progress-text"><span>${earned ? `${requirementText} / ${requirementText}` : escapeHtml(available ? `${currentText} / ${requirementText}` : progressText)}</span><span>${available || earned ? `${earned ? 100 : progress}%` : "—"}</span></div></div><span class="${earned ? "badge-check" : "badge-lock"}"><i class="fa-solid fa-${earned ? "check" : "lock"}"></i> ${earned ? "Earned" : "Locked"}</span><p class="badge-reward">${earned ? `${Number(unlock.xp_earned || 0)} XP earned` : `${xp} XP reward`}<span>${escapeHtml(unlockText)}</span></p></article>`;
    }).join("");
  }

  function render() {
    if (!state.loaded) return;
    const earnedIds = new Set(state.definitions
      .filter(unlockedFor)
      .map((definition) => String(definition.id)));
    const earned = earnedIds.size;
    const total = state.definitions.length;
    const completion = percent(earned, total);
    const metrics = state.metrics || {};
    const earnedAchievementXp = state.unlocked.reduce(
      (sum, item) => sum + (Number(item.xp_earned) || 0),
      0,
    );
    $("totalPoints").textContent = `${earnedAchievementXp.toLocaleString()} XP`;
    renderXpLevel(earnedAchievementXp);
    $("earnedCount").textContent = earned;
    $("availableCount").textContent = `Out of ${total} available`;
    $("currentStreak").textContent = `${metrics.studyStreak || 0} Days`;
    $("bestStreak").textContent = `Your best is ${metrics.bestStreak || 0} days`;
    $("challengesCompleted").textContent = metrics.challengesCompleted || 0;
    $("challengesPeriod").textContent = "Configured challenges";
    renderAchievementProgress(earnedIds, completion);
    renderNextAchievement();
    const recent = [...state.unlocked].sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at)).slice(0, 5).map((item) => {
      const definition = item.definition ||
        state.definitions.find((entry) => String(entry.id) === String(item.achievement_id));
      if (!definition) return "";
      const illustration = achievementIllustration(definition);
      const xp = Number(item.xp_earned);
      const xpIndicator = Number.isFinite(xp) && xp > 0
        ? `<span class="achievement-xp">+${xp.toLocaleString()} XP</span>`
        : "";
      return `<article class="achievement-item" data-tone="${illustration.tone}"><div class="achievement-art">${illustration.svg}</div><div class="achievement-info"><strong>${escapeHtml(definition.title)}</strong><span>${escapeHtml(definition.description)}</span><div class="achievement-meta">${xpIndicator}<span class="achievement-earned"><i class="fa-solid fa-check" aria-hidden="true"></i> Earned</span></div></div><div class="achievement-date">${relativeDate(item.unlocked_at)}</div></article>`;
    }).join("");
    $("recentAchievements").innerHTML = recent || "";
    if (!recent) setRecentMessage("Your unlocked badges will appear here as you reach each milestone.", "empty");
    renderBadges();
  }

  function renderXpLevel(xp) {
    const levelService = window.StudentXpLevel;
    if (!levelService?.getLevel) {
      throw new Error("The shared XP level service did not load.");
    }
    const { currentXp, current, next, progress, remaining } = levelService.getLevel(xp);
    const icon = $("xpLevelIcon");
    const progressTrack = $("xpLevelProgressTrack");
    const progressFill = $("xpLevelProgressFill");
    if (!icon || !progressTrack || !progressFill) return;

    $("xpLevelTitle").textContent = current.title;
    $("xpLevelNumber").textContent = `Level ${current.number}`;
    $("xpLevelBalance").textContent = `${currentXp.toLocaleString()} XP Coins`;
    icon.dataset.levelColor = current.color;
    icon.innerHTML = `<i class="fa-solid ${current.icon}" aria-hidden="true"></i>`;

    if (!next) {
      $("xpLevelProgressLabel").textContent = "MAX LEVEL";
      $("xpLevelPercent").textContent = "100%";
      $("xpLevelRemaining").textContent = "You reached the highest XP level.";
      progressFill.style.width = "100%";
      progressTrack.setAttribute("aria-valuenow", "100");
      progressTrack.setAttribute("aria-valuetext", "Maximum level reached");
      return;
    }

    $("xpLevelProgressLabel").textContent =
      `${currentXp.toLocaleString()} / ${next.minXp.toLocaleString()} XP`;
    $("xpLevelPercent").textContent = `${Math.round(progress)}%`;
    $("xpLevelRemaining").textContent =
      `${remaining.toLocaleString()} XP Coins to ${next.title}`;
    progressFill.style.width = `${progress}%`;
    progressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
    progressTrack.setAttribute(
      "aria-valuetext",
      `${currentXp} XP Coins; ${remaining} needed for ${next.title}`,
    );
  }

  function renderAchievementProgress(earnedIds, completion) {
    const content = $("achievementProgressContent");
    const empty = $("achievementProgressEmpty");
    const ring = $("achievementProgressRing");
    const details = $("achievementProgressDetails");
    const milestones = $("progressMilestones");
    if (!content || !empty || !ring || !details || !milestones) return;

    content.hidden = false;
    empty.classList.remove("is-visible");
    empty.setAttribute("role", "status");
    ring.classList.remove("is-loading", "is-error");
    details.classList.remove("is-loading");

    if (!state.definitions.length) {
      content.hidden = true;
      empty.textContent = "No active achievements are available yet. Check back as new learning milestones are added.";
      empty.classList.add("is-visible");
      milestones.replaceChildren();
      return;
    }

    const total = state.definitions.length;
    const remaining = Math.max(0, total - earnedIds.size);
    const circumference = 2 * Math.PI * 65;
    $("completionPercent").textContent = `${completion}%`;
    $("progressHeading").textContent = remaining ? "Keep going!" : "All achievements unlocked!";
    $("progressDescription").textContent = remaining
      ? `You have unlocked ${earnedIds.size} out of ${total} available achievements.`
      : `Congratulations! You have unlocked all ${total} available achievements.`;
    $("earnedLabel").innerHTML = `<i class="fa-solid fa-star" aria-hidden="true"></i> ${earnedIds.size} earned`;
    $("remainingLabel").innerHTML = `<i class="fa-solid fa-lock" aria-hidden="true"></i> ${remaining} remaining`;
    $("achievementProgressArc").style.strokeDasharray = `${circumference}`;
    $("achievementProgressArc").style.strokeDashoffset = `${circumference * (1 - completion / 100)}`;
    ring.setAttribute("aria-label", `${completion}% completed; ${earnedIds.size} of ${total} achievements earned`);
    milestones.setAttribute("aria-label", `${earnedIds.size} of ${total} achievements earned`);
    milestones.innerHTML = state.definitions.map((definition) => {
      const earned = earnedIds.has(String(definition.id));
      const title = escapeHtml(definition.title || "Achievement");
      return `<span class="progress-milestone ${earned ? "is-earned" : "is-locked"}" title="${title}" aria-label="${title}: ${earned ? "earned" : "locked"}" role="img"><i class="fa-solid fa-${earned ? "check" : "lock"}" aria-hidden="true"></i></span>`;
    }).join("");
  }

  function renderAchievementProgressError(message) {
    const content = $("achievementProgressContent");
    const empty = $("achievementProgressEmpty");
    const ring = $("achievementProgressRing");
    if (!content || !empty || !ring) return;
    content.hidden = true;
    ring.classList.remove("is-loading");
    ring.classList.add("is-error");
    $("completionPercent").textContent = "—";
    empty.textContent = `Achievement progress is unavailable: ${message || "Please try again later."}`;
    empty.setAttribute("role", "alert");
    empty.classList.add("is-visible");
  }

  function bindFilters() {
    document.querySelectorAll(".filter-btn").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $("badgesGrid").querySelectorAll(".badge-card").forEach((card) => {
        card.style.display = button.dataset.filter === "all" ||
          card.dataset.status === button.dataset.filter
          ? "block"
          : "none";
      });
    }));
    $("badgesGrid").addEventListener("click", (event) => {
      const card = event.target.closest(".badge-card");
      if (!card) return;
      const title = card.querySelector("h3");
      if (!title) return;
      window.alert(card.dataset.status === "locked"
        ? `${title.textContent.trim()} is still locked. Keep learning to unlock it!`
        : `🏆 ${title.textContent.trim()} achievement earned!`);
    });
  }

  async function init() {
    bindFilters();
    render();
    setStatus("Loading your achievements…");
    setGridMessage("Loading your achievements…");
    setRecentMessage("Loading your recent achievements…", "loading");
    const supabase = window.SmartLearningSupabase;
    if (!supabase || typeof supabase.getClient !== "function") {
      const message = "The existing Supabase client is unavailable on this page.";
      console.error(message);
      setStatus(message, true);
      setGridMessage(message, true);
      setRecentMessage(message, "error");
      return;
    }
    try {
      state.client = supabase.getClient();
    } catch (error) {
      const message = `The existing Supabase client could not be initialized: ${error.message || "Unknown error."}`;
      console.error(message, error);
      setStatus(message, true);
      setGridMessage(message, true);
      setRecentMessage(message, "error");
      return;
    }
    if (!state.client) {
      const configured = typeof supabase.isConfigured === "function"
        ? supabase.isConfigured()
        : null;
      const message = configured === true
        ? "Supabase reports that it is configured, but getClient() did not return a client."
        : "Supabase did not provide a client. Check the existing client initialization.";
      console.error(message);
      setStatus(message, true);
      setGridMessage(message, true);
      setRecentMessage(message, "error");
      return;
    }
    let authData;
    try {
      const { data, error } = await state.client.auth.getUser();
      if (error) throw error;
      authData = data;
    } catch (error) {
      const message = `Could not verify your student session: ${error.message || "Please sign in again."}`;
      console.error(message, error);
      setStatus(message, true);
      setGridMessage(message, true);
      setRecentMessage(message, "error");
      return;
    }
    state.user = authData?.user || null;
    if (!state.user) {
      const message = "Sign in with your student account to view achievements.";
      setStatus(message, true);
      setGridMessage(message, true);
      setRecentMessage(message, "error");
      return;
    }

    try {
      const { data: student, error } = await state.client
        .from("students")
        .select("id, grade, stream")
        .eq("user_id", state.user.id)
        .single();
      if (error) throw error;
      if (!student?.id) throw new Error("Your student registration could not be found.");
      renderRegistrationContext(student);
      state.studentId = String(student.id);

      let evaluationError = null;
      try {
        await evaluateStudentAchievements();
      } catch (error) {
        console.error("Could not evaluate student achievements on page load.", error);
        evaluationError = error;
      }
      await refreshAchievements();
      const statusMessages = [];
      if (evaluationError) statusMessages.push("Achievement evaluation failed; showing your latest saved achievements.");
      if (state.progressErrors.length) {
        statusMessages.push("Some progress values are unavailable. Achievement records are still shown.");
      }
      setStatus(statusMessages.join(" "), Boolean(evaluationError));

      const refreshAfterUnlock = () => {
        void refreshAchievements().catch((refreshError) => {
          console.error("Could not refresh achievements after an unlock changed.", refreshError);
          setStatus("Achievements could not be refreshed. Please reload the page.", true);
          setGridMessage("Achievements could not be refreshed. Please reload the page.", true);
          setRecentMessage("Recent achievements could not be refreshed. Please reload the page.", "error");
        });
      };
      let channel = state.client.channel(`achievements-${state.user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "quiz_attempts", filter: `student_id=eq.${state.studentId}` }, () => {
          void refreshAchievements().catch((refreshError) => {
            console.error("Could not refresh achievements after quiz progress changed.", refreshError);
            setStatus("Achievements could not be refreshed. Please reload the page.", true);
            setGridMessage("Achievements could not be refreshed. Please reload the page.", true);
            setRecentMessage("Recent achievements could not be refreshed. Please reload the page.", "error");
          });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "study_sessions", filter: `student_id=eq.${state.studentId}` }, () => {
          void refreshAchievements().catch((refreshError) => {
            console.error("Could not refresh achievements after study progress changed.", refreshError);
            setStatus("Achievements could not be refreshed. Please reload the page.", true);
            setGridMessage("Achievements could not be refreshed. Please reload the page.", true);
            setRecentMessage("Recent achievements could not be refreshed. Please reload the page.", "error");
          });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "student_achievements", filter: `student_id=eq.${state.user.id}` }, refreshAfterUnlock);
      if (String(state.studentId) !== String(state.user.id)) {
        channel = channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "student_achievements", filter: `student_id=eq.${state.studentId}` },
          refreshAfterUnlock,
        );
      }
      channel.subscribe();

      window.addEventListener("storage", (event) => {
        if (event.key !== "student-achievement-data-refresh" || !state.client || !state.user) return;
        void refreshAchievements().catch((refreshError) => {
          console.error("Could not refresh achievements after a material was completed.", refreshError);
          setStatus("Achievement progress could not be refreshed. Please reload the page.", true);
        });
      });
    } catch (error) {
      console.error("Achievements are unavailable.", error);
      const message = `Could not load achievements from Supabase: ${error.message || "Please try again."}`;
      setStatus(message, true);
      setGridMessage(message, true);
      setRecentMessage(message, "error");
    }
  }

  window.StudentAchievements = { refresh: refreshAchievements };
  document.addEventListener("DOMContentLoaded", () => void init());
})();
