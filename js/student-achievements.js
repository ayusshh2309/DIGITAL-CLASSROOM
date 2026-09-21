(() => {
  const profileKeys = ["studentProfile", "studentData", "finalStudentRegistration"];
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  const state = { client: null, user: null, definitions: [], unlocked: [], transactions: [], metrics: null };

  function readProfile() {
    return profileKeys.map((key) => {
      try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
    }).find((profile) => profile && (profile.classGrade || profile.class_grade || profile.grade)) || {};
  }

  function dateKey(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function calculateStreak(sessions) {
    const days = [...new Set(sessions.filter((session) => session.status === "completed").map((session) => dateKey(session.end_time || session.start_time)).filter(Boolean))].sort().reverse();
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

  function metricsFrom(rows) {
    const sessions = rows.sessions || [];
    const completedSessions = sessions.filter((session) => session.status === "completed");
    const minutes = completedSessions.reduce((total, session) => total + Number(session.duration_seconds || 0) / 60, 0);
    const currentWeek = Date.now() - 7 * 86400000;
    const weeklyMinutes = completedSessions.filter((session) => new Date(session.end_time || session.start_time).getTime() >= currentWeek).reduce((total, session) => total + Number(session.duration_seconds || 0) / 60, 0);
    const today = dateKey(new Date());
    const sessionsToday = completedSessions.filter((session) => dateKey(session.end_time || session.start_time) === today).length;
    const highScoreQuizzes = (rows.quizzes || []).filter((attempt) => Number(attempt.total_marks) > 0 && Number(attempt.score) / Number(attempt.total_marks) * 100 >= 90).length;
    const streak = calculateStreak(sessions);
    return {
      completedSessions: completedSessions.length,
      sessionsToday,
      completedResources: new Set((rows.downloads || []).map((row) => row.material_id)).size + (rows.videos || []).filter((row) => row.completed).length,
      weeklyStudyMinutes: weeklyMinutes,
      highScoreQuizzes,
      studyStreak: streak.current,
      bestStreak: streak.best,
      challengesCompleted: 0,
      rankingPosition: null,
      totalStudyMinutes: minutes,
    };
  }

  function metricValue(definition) {
    const metrics = state.metrics || {};
    return Number(metrics[{ sessions_in_day: "sessionsToday", study_streak: "studyStreak", high_score_quizzes: "highScoreQuizzes", weekly_study_minutes: "weeklyStudyMinutes", completed_sessions: "completedSessions", completed_resources: "completedResources", ranking_position: "rankingPosition" }[definition.requirement_type]] || 0);
  }

  async function loadRows() {
    const queries = await Promise.all([
      state.client.from("study_sessions").select("id,status,start_time,end_time,duration_seconds").eq("student_id", state.user.id),
      state.client.from("student_video_progress").select("video_id,completed").eq("student_id", state.user.id),
      state.client.from("material_downloads").select("material_id").eq("student_id", state.user.id),
      state.client.from("quiz_attempts").select("id,score,total_marks,completed_at").eq("student_id", state.user.id),
    ]);
    return { sessions: queries[0].error ? [] : queries[0].data || [], videos: queries[1].error ? [] : queries[1].data || [], downloads: queries[2].error ? [] : queries[2].data || [], quizzes: queries[3].error ? [] : queries[3].data || [] };
  }

  async function evaluate() {
    if (!state.client || !state.user) return;
    const rows = await loadRows();
    state.metrics = metricsFrom(rows);
    const definitionsResult = await state.client.from("achievement_definitions").select("*").eq("active", true).order("created_at");
    if (definitionsResult.error) throw definitionsResult.error;
    state.definitions = definitionsResult.data || [];
    const unlockedResult = await state.client.from("student_achievements").select("achievement_id,unlocked_at").eq("student_id", state.user.id);
    state.unlocked = unlockedResult.error ? [] : unlockedResult.data || [];
    const unlockedIds = new Set(state.unlocked.map((item) => item.achievement_id));
    const newUnlocks = state.definitions.filter((definition) => metricValue(definition) >= Number(definition.requirement_value) && !unlockedIds.has(definition.id));
    for (const definition of newUnlocks) {
      const unlock = await state.client.from("student_achievements").insert({ student_id: state.user.id, achievement_id: definition.id }).select("achievement_id,unlocked_at").maybeSingle();
      if (!unlock.error && unlock.data) {
        state.unlocked.push(unlock.data);
        await state.client.from("student_xp_transactions").upsert({ student_id: state.user.id, source_type: "achievement", source_id: definition.id, reason: "achievement_unlock", xp: Number(definition.xp_reward) }, { onConflict: "student_id,source_type,source_id,reason", ignoreDuplicates: true });
      }
    }
    const transactionsResult = await state.client.from("student_xp_transactions").select("xp").eq("student_id", state.user.id);
    state.transactions = transactionsResult.error ? [] : transactionsResult.data || [];
    render();
  }

  function unlockedFor(definition) { return state.unlocked.find((item) => item.achievement_id === definition.id); }
  function percent(value, total) { return total ? Math.min(100, Math.round(value / total * 100)) : 0; }
  function relativeDate(value) {
    const date = new Date(value);
    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function renderBadges() {
    const grid = $("badgesGrid");
    if (!grid) return;
    grid.innerHTML = state.definitions.map((definition) => {
      const earned = Boolean(unlockedFor(definition));
      return `<div class="badge-card ${earned ? "earned" : "locked"}" data-status="${earned ? "earned" : "locked"}" data-achievement-id="${escapeHtml(definition.id)}"><div class="badge-big ${earned ? `badge-${escapeHtml(definition.color)}` : ""}"><i class="fa-solid ${escapeHtml(definition.icon)}"></i></div><h3>${escapeHtml(definition.name)}</h3><p>${escapeHtml(definition.description)}</p><span class="${earned ? "badge-check" : "badge-lock"}"><i class="fa-solid fa-${earned ? "check" : "lock"}"></i> ${earned ? "Earned" : "Locked"}</span></div>`;
    }).join("");
  }

  function render() {
    const earned = state.definitions.filter(unlockedFor).length;
    const total = state.definitions.length;
    const completion = percent(earned, total);
    const metrics = state.metrics || {};
    $("totalPoints").textContent = `${state.transactions.reduce((sum, item) => sum + Number(item.xp || 0), 0).toLocaleString()} XP`;
    $("earnedCount").textContent = earned;
    $("availableCount").textContent = `Out of ${total} available`;
    $("currentStreak").textContent = `${metrics.studyStreak || 0} Days`;
    $("bestStreak").textContent = `Your best is ${metrics.bestStreak || 0} days`;
    $("challengesCompleted").textContent = metrics.challengesCompleted || 0;
    $("challengesPeriod").textContent = "Configured challenges";
    $("achievementRank").textContent = "Not ranked";
    $("rankDescription").textContent = "Ranking is not enabled";
    $("completionPercent").textContent = `${completion}%`;
    $("progressDescription").textContent = `You have unlocked ${earned} out of ${total} available achievements.`;
    $("progressFill").style.width = `${completion}%`;
    $("earnedLabel").textContent = `${earned} earned`;
    $("remainingLabel").textContent = `${Math.max(0, total - earned)} remaining`;
    const locked = state.definitions.filter((definition) => !unlockedFor(definition)).sort((a, b) => metricValue(b) / Number(b.requirement_value) - metricValue(a) / Number(a.requirement_value))[0];
    if (locked) {
      const current = Math.min(metricValue(locked), Number(locked.requirement_value));
      $("nextAchievementName").textContent = locked.name;
      $("nextAchievementDescription").textContent = locked.description;
      $("nextAchievementIcon").className = `fa-solid ${locked.icon}`;
      $("nextProgressFill").style.width = `${percent(current, Number(locked.requirement_value))}%`;
      $("nextProgressLabel").textContent = `${current} / ${locked.requirement_value}`;
      $("nextRemainingLabel").textContent = `${Math.max(0, Number(locked.requirement_value) - current)} more`;
    }
    const recent = [...state.unlocked].sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at)).slice(0, 5).map((item) => {
      const definition = state.definitions.find((entry) => entry.id === item.achievement_id);
      if (!definition) return "";
      return `<div class="achievement-item"><div class="achievement-left"><div class="badge badge-${escapeHtml(definition.color)}"><i class="fa-solid ${escapeHtml(definition.icon)}"></i></div><div class="achievement-info"><strong>${escapeHtml(definition.name)}</strong><span>${escapeHtml(definition.description)}</span></div></div><div class="earned-date">${relativeDate(item.unlocked_at)}</div></div>`;
    }).join("");
    $("recentAchievements").innerHTML = recent || '<p class="empty-state">No achievements unlocked yet.</p>';
    renderBadges();
    renderCategories();
  }

  function renderCategories() {
    const grid = $("categoryGrid");
    if (!grid) return;
    [...grid.querySelectorAll(".category")].forEach((category) => {
      const name = category.querySelector(".category-name")?.textContent.trim();
      const definitions = state.definitions.filter((definition) => definition.category.toLowerCase() === String(name).toLowerCase());
      const earned = definitions.filter(unlockedFor).length;
      const value = percent(earned, definitions.length);
      category.querySelector(".category-percent").textContent = `${value}%`;
      category.querySelector(".category-fill").style.width = `${value}%`;
    });
  }

  function bindFilters() {
    document.querySelectorAll(".filter-btn").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.querySelectorAll(".badge-card").forEach((card) => { card.style.display = button.dataset.filter === "all" || card.dataset.status === button.dataset.filter ? "block" : "none"; });
    }));
  }

  async function init() {
    state.client = window.SmartLearningSupabase?.getClient?.();
    bindFilters();
    if (!state.client) return;
    const { data: { user } } = await state.client.auth.getUser();
    state.user = user;
    if (!user) return;
    await evaluate();
    state.client.channel(`achievements-${user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "study_sessions", filter: `student_id=eq.${user.id}` }, evaluate).subscribe();
  }

  window.StudentAchievements = { evaluate };
  document.addEventListener("DOMContentLoaded", () => init().catch((error) => console.error("Achievements are unavailable.", error)));
})();
