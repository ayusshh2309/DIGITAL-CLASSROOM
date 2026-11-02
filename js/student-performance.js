(() => {
  const state = {
    context: null,
    groups: [],
    grade: "",
    stream: "",
    subject: "",
    students: [],
    records: [],
    performance: null,
    achievementsByStudent: {},
    achievementSummary: {
      totalXp: 0,
      studentsWithAchievements: 0,
      unlockedCount: 0,
    },
    achievementError: "",
    query: "",
    category: "All",
    sort: "average-desc",
    page: 1,
    pageSize: 8,
    stopRealtime: () => {},
    requestId: 0,
  };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const percent = (value) => value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : `${Math.round(Number(value) * 10) / 10}%`;
  const showEmpty = (message, icon = "fa-chart-line") =>
    `<div class="empty"><i class="fa-solid ${icon}"></i>${esc(message)}</div>`;
  const achievementIcon = (value) => {
    const classes = String(value || "fa-award")
      .split(/\s+/)
      .filter((name) => /^fa-[a-z0-9-]+$/i.test(name));
    return classes.length ? classes.join(" ") : "fa-award";
  };
  const formatUnlockDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? "Date unavailable"
      : date.toLocaleDateString();
  };

  function renderError(message) {
    ["performanceBody", "overviewChart", "subjectBars", "topPerformers", "distribution", "insights"].forEach((id) => {
      if ($(id)) $(id).innerHTML = showEmpty(message, "fa-circle-exclamation");
    });
    $("achievementXpTotal").textContent = "—";
    $("achievementStudentCount").textContent = "—";
    $("achievementUnlockedCount").textContent = "—";
    $("studentAchievementXpBody").innerHTML =
      `<tr><td colspan="3">${showEmpty(message, "fa-circle-exclamation")}</td></tr>`;
    $("achievementList").innerHTML = showEmpty(message, "fa-circle-exclamation");
  }

  function renderClassOptions() {
    const classes = PerformanceService.registeredClasses(state.groups);
    $("classSelector").replaceChildren(...(classes.length
      ? classes.map((grade) => new Option(`Class ${grade}`, String(grade)))
      : [new Option("No registered classes", "")]));
    if (!classes.map(String).includes(state.grade)) state.grade = String(classes[0] || "");
    $("classSelector").value = state.grade;
  }

  function renderStreamOptions() {
    const streamSelect = $("streamSelector");
    const streams = PerformanceService.registeredGroups(state.groups, state.grade);
    const hasStreams = Number(state.grade) >= 11;
    streamSelect.hidden = !hasStreams;
    streamSelect.disabled = !hasStreams;
    const options = hasStreams
      ? streams.filter((group) => group.stream).map((group) => group.stream)
      : [""];
    streamSelect.replaceChildren(...(hasStreams
      ? options.map((stream) => new Option(PerformanceService.streamLabels[stream] || stream, stream))
      : [new Option("Not applicable", "")]));
    if (!options.includes(state.stream)) state.stream = options[0] || "";
    streamSelect.value = state.stream;
  }

  function renderSubjectOptions() {
    const subjects = PerformanceService.registeredSubjects(state.groups, state.grade, state.stream);
    const select = $("subjectSelector");
    select.replaceChildren(
      new Option("All registered subjects", ""),
      ...subjects.map((subject) => new Option(subject.name, String(subject.id))),
    );
    if (!subjects.some((subject) => String(subject.id) === state.subject)) state.subject = "";
    select.value = state.subject;
  }

  async function loadData({ resubscribe = false } = {}) {
    const requestId = ++state.requestId;
    if (!state.grade || (Number(state.grade) >= 11 && !state.stream)) {
      state.students = [];
      state.records = [];
      state.achievementsByStudent = {};
      state.achievementSummary = {
        totalXp: 0,
        studentsWithAchievements: 0,
        unlockedCount: 0,
      };
      state.achievementError = "";
      state.performance = PerformanceService.calculatePerformance([], [], []);
      renderAll();
      return;
    }
    const result = await PerformanceService.loadPerformanceData({
      ...state.context,
      grade: state.grade,
      stream: state.stream,
      subjectId: state.subject,
      groups: state.groups,
    });
    if (requestId !== state.requestId) return;
    state.students = result.students;
    state.records = result.records;
    state.achievementsByStudent = result.achievementsByStudent || {};
    state.achievementError = result.achievementError || "";
    state.achievementSummary = result.achievementSummary || {
      totalXp: 0,
      studentsWithAchievements: 0,
      unlockedCount: 0,
    };
    state.performance = PerformanceService.calculatePerformance(result.records, result.students, result.subjects);
    renderAll();
    if (resubscribe) setupRealtime();
  }

  function renderSummary() {
    const data = state.performance;
    const hasResults = data.records.length > 0;
    $("statClassAvg").textContent = percent(data.classAverage);
    $("statHighestScore").textContent = percent(data.highestScore);
    $("statImprovement").textContent = percent(data.improvement);
    $("statNeedsHelp").textContent = hasResults ? String(data.needsHelp) : "—";
    $("statTotalStudents").textContent = String(data.totalStudents);
    const top = [...data.students].filter((student) => student.records.length).sort((a, b) => b.average - a.average)[0];
    $("statTopStudentName").textContent = top ? top.name : "—";
    $("statClassAvgSub").textContent = hasResults
      ? `${data.records.length} submitted quiz result${data.records.length === 1 ? "" : "s"}`
      : "No quiz results available yet.";
    $("overviewSubjectLabel").textContent = state.subject
      ? $("subjectSelector").selectedOptions[0]?.textContent || "Selected subject"
      : "All registered subjects";
  }

  function renderOverview() {
    const chart = $("overviewChart");
    const points = state.records
      .map((record) => ({
        date: String(record.assessment_date || "").slice(0, 10),
        timestamp: new Date(record.assessment_date).getTime(),
        value: record.percentage === null || record.percentage === undefined ||
          String(record.percentage).trim() === ""
          ? Number.NaN
          : Number(record.percentage),
      }))
      .filter((point) =>
        point.date.length > 0 &&
        Number.isFinite(point.timestamp) &&
        Number.isFinite(point.value) &&
        point.value >= 0 &&
        point.value <= 100,
      )
      .sort((left, right) => left.timestamp - right.timestamp);
    if (!points.length) {
      chart.innerHTML = showEmpty("No quiz results available yet.");
      return;
    }
    const width = 700;
    const height = 230;
    const plotLeft = 58;
    const plotRight = 682;
    const plotTop = 36;
    const plotBottom = 174;
    const firstTimestamp = points[0].timestamp;
    const lastTimestamp = points.at(-1).timestamp;
    const pointPosition = (point) => ({
      x: points.length === 1 || firstTimestamp === lastTimestamp
        ? (plotLeft + plotRight) / 2
        : plotLeft + (point.timestamp - firstTimestamp) /
          (lastTimestamp - firstTimestamp) * (plotRight - plotLeft),
      y: plotBottom - point.value / 100 * (plotBottom - plotTop),
    });
    const gridlines = [0, 25, 50, 75, 100].map((value) => {
      const y = plotBottom - value / 100 * (plotBottom - plotTop);
      return `<g class="performance-chart-grid"><line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}"/><text x="${plotLeft - 10}" y="${y + 4}" text-anchor="end">${value}%</text></g>`;
    }).join("");
    const positions = points.map(pointPosition);
    const path = positions.map((position, index) => {
      return `${index ? "L" : "M"} ${position.x.toFixed(1)} ${position.y.toFixed(1)}`;
    }).join(" ");
    const circles = points.map((point, index) => {
      const position = positions[index];
      const radius = points.length === 1 ? 8 : 4.5;
      return `<circle class="performance-chart-point${points.length === 1 ? " is-single" : ""}" cx="${position.x}" cy="${position.y}" r="${radius}"><title>${esc(point.date)}: ${percent(point.value)}</title></circle>`;
    }).join("");
    const singlePointLabels = points.length === 1
      ? `<text class="performance-chart-value" x="${positions[0].x}" y="${Math.max(plotTop - 12, positions[0].y - 14)}" text-anchor="middle">${percent(points[0].value)}</text><text class="performance-chart-date" x="${positions[0].x}" y="${plotBottom + 25}" text-anchor="middle">${esc(points[0].date)}</text>`
      : `<text class="performance-chart-date" x="${plotLeft}" y="${plotBottom + 25}" text-anchor="start">${esc(points[0].date)}</text><text class="performance-chart-date" x="${plotRight}" y="${plotBottom + 25}" text-anchor="end">${esc(points.at(-1).date)}</text>`;
    const status = points.length === 1 ? "1 quiz completed" : `${points.length} quizzes completed`;
    const line = points.length > 1
      ? `<path class="performance-chart-line" d="${path}"/>`
      : "";
    chart.innerHTML = `<svg class="performance-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Performance trend with ${esc(status)}"><text class="performance-chart-status" x="${plotLeft}" y="18">${esc(status)}</text>${gridlines}${line}${circles}${singlePointLabels}</svg>`;
  }

  function renderSubjects() {
    const rows = state.performance.subjects.filter((subject) => subject.count);
    $("subjectBars").innerHTML = rows.length ? rows.map((subject) => `<div class="subject-row"><span>${esc(subject.subject)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, subject.average))}%"></div></div><strong>${Math.round(subject.average)}%</strong></div>`).join("") : showEmpty("No quiz results available yet.", "fa-book-open");
  }

  function filteredStudents() {
    return state.performance.students.filter((student) =>
      (!state.query || `${student.name} ${student.studentCode} ${student.roll_no}`.toLowerCase().includes(state.query))
      && (state.category === "All" || student.category === state.category),
    ).sort((a, b) => {
      if (state.sort === "name-asc") return a.name.localeCompare(b.name);
      if (state.sort === "average-asc") return (a.average ?? Infinity) - (b.average ?? Infinity);
      if (state.sort === "trend-desc") return (b.trend.value ?? -Infinity) - (a.trend.value ?? -Infinity);
      return (b.average ?? -Infinity) - (a.average ?? -Infinity);
    });
  }

  function renderTable() {
    const students = filteredStudents();
    const totalPages = Math.max(1, Math.ceil(students.length / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const visible = students.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    $("performanceBody").innerHTML = visible.length ? visible.map((student) => `<tr><td><button class="student-button" data-student="${esc(student.id)}">${esc(student.name)}</button><br><small style="color:#718196">${esc(student.studentCode)} · Roll ${esc(student.roll_no)}</small></td><td class="score-pill">${percent(student.average)}</td><td>${Object.entries(student.subjectScores).filter(([, value]) => value !== null).map(([subject, value]) => `<span style="display:inline-block;margin:2px 5px 2px 0;color:#53677d">${esc(subject)} <strong>${value}%</strong></span>`).join("") || '<span style="color:#9aa8b6">—</span>'}</td><td class="trend-${student.trend.direction}">${student.trend.value === null ? "—" : `${student.trend.value > 0 ? "+" : ""}${percent(student.trend.value)} · ${esc(student.trend.label)}`}</td><td>${student.records.length ? `<span class="category ${student.category.toLowerCase().replaceAll(" ", "-")}">${esc(student.category)}</span>` : "—"}</td></tr>`).join("") : `<tr><td colspan="5">${showEmpty(state.students.length ? "No students match these filters." : "No registered students found for this grade and stream.", "fa-user-group")}</td></tr>`;
    $("paginationInfo").textContent = students.length
      ? `Showing ${(state.page - 1) * state.pageSize + 1}-${Math.min(state.page * state.pageSize, students.length)} of ${students.length} students`
      : "Showing 0 students";
    $("pageButtons").innerHTML = Array.from({ length: totalPages }, (_, index) => `<button class="${index + 1 === state.page ? "active" : ""}" data-page="${index + 1}">${index + 1}</button>`).join("");
  }

  function renderTopPerformers() {
    const top = state.performance.students
      .filter((student) => student.records.length)
      .sort((a, b) => b.average - a.average)
      .slice(0, 5);
    $("topPerformers").innerHTML = top.length
      ? top.map((student, index) => `<div class="performer-row"><span class="performer-rank">${index + 1}</span><span>${esc(student.name)}</span><strong>${percent(student.average)}</strong></div>`).join("")
      : showEmpty("No quiz results available yet.", "fa-trophy");
  }

  function renderDistribution() {
    const colors = { Excellent: "#139a70", Good: "#7257e8", Average: "#d28c18", "Needs Help": "#dc5960" };
    const assessed = state.performance.students.filter((student) => student.records.length).length;
    if (!assessed) {
      $("distribution").innerHTML = showEmpty("No quiz results available yet.", "fa-chart-pie");
      return;
    }
    $("distribution").innerHTML = Object.entries(state.performance.distribution).map(([label, count]) => `<div class="distribution-row"><span><i style="background:${colors[label]}"></i>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${(count / assessed) * 100}%;background:${colors[label]}"></div></div><strong>${count}</strong></div>`).join("");
  }

  function renderInsights() {
    $("insights").innerHTML = PerformanceService.insights(state.performance).map((message) => `<div class="insight"><i class="fa-solid fa-lightbulb"></i><span>${esc(message)}</span></div>`).join("");
  }

  function renderLearningEngagement() {
    if (state.achievementError) {
      const message = `Achievement data is unavailable: ${state.achievementError}`;
      $("achievementXpTotal").textContent = "—";
      $("achievementStudentCount").textContent = "—";
      $("achievementUnlockedCount").textContent = "—";
      $("studentAchievementXpBody").innerHTML =
        `<tr><td colspan="3">${showEmpty(message, "fa-circle-exclamation")}</td></tr>`;
      $("achievementList").innerHTML = showEmpty(message, "fa-circle-exclamation");
      return;
    }

    const summary = state.achievementSummary;
    $("achievementXpTotal").textContent = Number(summary.totalXp || 0).toLocaleString();
    $("achievementStudentCount").textContent = String(summary.studentsWithAchievements || 0);
    $("achievementUnlockedCount").textContent = String(summary.unlockedCount || 0);

    const students = state.performance.students;
    $("studentAchievementXpBody").innerHTML = students.length
      ? students.map((student) => {
          const progress = state.achievementsByStudent[student.id] || {
            totalXp: 0,
            achievements: [],
          };
          return `<tr><td>${esc(student.name)}</td><td>${progress.achievements.length}</td><td class="achievement-xp-value">${Number(progress.totalXp || 0).toLocaleString()} XP</td></tr>`;
        }).join("")
      : `<tr><td colspan="3">${showEmpty("No students found for this class and stream.", "fa-user-group")}</td></tr>`;
  }

  function renderAchievements() {
    const unlocked = state.performance.students.flatMap((student) => {
      const progress = state.achievementsByStudent[student.id];
      return (progress?.achievements || []).map((achievement) => ({
        studentName: student.name,
        ...achievement,
      }));
    });
    $("achievementList").innerHTML = unlocked.length
      ? unlocked.map((achievement) => `<article class="achievement-card"><span class="achievement-icon"><i class="fa-solid ${esc(achievementIcon(achievement.icon))}" aria-hidden="true"></i></span><div class="achievement-content"><div class="achievement-title-row"><h3>${esc(achievement.title)}</h3><span class="achievement-xp-value">${Number(achievement.xpEarned || 0).toLocaleString()} XP</span></div><p>${esc(achievement.description || "Achievement details unavailable.")}</p><div class="achievement-meta"><strong>${esc(achievement.studentName)}</strong><span>${esc(achievement.category || "Achievement")}</span><time>${esc(formatUnlockDate(achievement.unlockedAt))}</time></div></div></article>`).join("")
      : showEmpty("No achievements unlocked yet.", "fa-award");
  }

  function renderAll() {
    renderSummary();
    renderOverview();
    renderSubjects();
    renderTable();
    renderTopPerformers();
    renderDistribution();
    renderInsights();
    renderLearningEngagement();
    renderAchievements();
  }

  function openDrawer(studentId) {
    const student = state.performance.students.find((item) => item.id === studentId);
    if (!student) return;
    const records = [...student.records].sort((a, b) => new Date(b.assessment_date) - new Date(a.assessment_date));
    const engagement = state.achievementsByStudent[student.id] || {
      totalXp: 0,
      achievements: [],
    };
    const unlockedBadges = engagement.achievements;
    const engagementXp = state.achievementError
      ? "—"
      : Number(engagement.totalXp || 0).toLocaleString();
    const unlockedBadgeCount = state.achievementError
      ? "—"
      : String(unlockedBadges.length);
    $("performanceDrawer").innerHTML = `<div class="performance-drawer-backdrop"><aside class="performance-drawer"><button class="performance-drawer-close" data-close aria-label="Close student details"><i class="fa-solid fa-xmark"></i></button><span class="page-eyebrow"><i class="fa-solid fa-user-graduate"></i> Student performance</span><h2 style="margin:8px 0 4px">${esc(student.name)}</h2><p class="drawer-meta">Class ${esc(state.grade)}${state.stream ? ` · ${esc(PerformanceService.streamLabels[state.stream] || state.stream)}` : ""} · ${esc(student.studentCode)}</p><div class="drawer-stats"><div class="drawer-stat"><strong>${percent(student.average)}</strong><small>Overall average</small></div><div class="drawer-stat"><strong>${esc(student.category)}</strong><small>Category</small></div><div class="drawer-stat"><strong>${student.trend.value === null ? "—" : percent(student.trend.value)}</strong><small>Recent trend</small></div><div class="drawer-stat"><strong>${records.length}</strong><small>Submitted quizzes</small></div></div><h3>Subject performance</h3>${Object.entries(student.subjectScores).map(([subject, value]) => `<div class="assessment-item"><span>${esc(subject)}</span><strong>${percent(value)}</strong></div>`).join("")}<h3 style="margin-top:22px">Quiz history</h3>${records.length ? records.map((record) => `<div class="assessment-item"><span>${esc(record.assessment_name)}<br><small style="color:#718196">${esc(String(record.assessment_date).slice(0, 10))} · ${esc(record.subject)}</small></span><strong>${percent(record.percentage)}</strong></div>`).join("") : `<p class="drawer-meta" style="margin-top:12px">No quiz results available yet.</p>`}<h3 style="margin-top:22px">Learning engagement</h3><div class="drawer-stats achievement-drawer-stats"><div class="drawer-stat"><strong>${Number(engagement.totalXp || 0).toLocaleString()}</strong><small>Total achievement XP</small></div><div class="drawer-stat"><strong>${unlockedBadges.length}</strong><small>Unlocked badges</small></div></div><h3 style="margin-top:18px">Unlocked badges</h3>${unlockedBadges.length ? unlockedBadges.map((achievement) => `<div class="drawer-achievement"><span class="achievement-icon"><i class="fa-solid ${esc(achievementIcon(achievement.icon))}" aria-hidden="true"></i></span><span><strong>${esc(achievement.title)}</strong><small>${esc(formatUnlockDate(achievement.unlockedAt))}</small></span><strong>${Number(achievement.xpEarned || 0).toLocaleString()} XP</strong></div>`).join("") : `<p class="drawer-meta" style="margin-top:12px">No achievements unlocked yet.</p>`}</aside></div>`;
    const achievementStats = $("performanceDrawer").querySelectorAll(
      ".achievement-drawer-stats .drawer-stat strong",
    );
    achievementStats[0].textContent = engagementXp;
    achievementStats[1].textContent = unlockedBadgeCount;
    if (state.achievementError) {
      const badgeHeading = [...$("performanceDrawer").querySelectorAll("h3")]
        .find((heading) => heading.textContent === "Unlocked badges");
      badgeHeading.nextElementSibling?.remove();
      const message = document.createElement("p");
      message.className = "drawer-meta";
      message.style.marginTop = "12px";
      message.textContent = `Achievement data is unavailable: ${state.achievementError}`;
      badgeHeading.after(message);
    }
  }

  async function selectScope() {
    state.grade = $("classSelector").value;
    state.stream = Number(state.grade) >= 11 ? $("streamSelector").value : "";
    state.subject = "";
    renderStreamOptions();
    renderSubjectOptions();
    state.page = 1;
    try {
      await loadData();
    } catch (error) {
      console.error("Performance data load failed:", error);
      renderError(error.message || "Performance data could not be loaded.");
    }
  }

  async function selectSubject() {
    state.subject = $("subjectSelector").value;
    state.page = 1;
    try {
      await loadData();
    } catch (error) {
      console.error("Performance data load failed:", error);
      renderError(error.message || "Performance data could not be loaded.");
    }
  }

  function setupRealtime() {
    state.stopRealtime();
    state.stopRealtime = PerformanceService.subscribeToPerformance({
      client: state.context.client,
      teacher: state.context.teacher,
      onChange: () => {
        void loadData().catch((error) => {
          console.error("Realtime performance refresh failed:", error);
          renderError("Performance data could not be refreshed.");
        });
      },
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    $("performanceMode").textContent = "Supabase mode";
    try {
      state.context = await PerformanceService.initialize();
      state.groups = state.context.groups;
      renderClassOptions();
      renderStreamOptions();
      renderSubjectOptions();
      await loadData({ resubscribe: true });
    } catch (error) {
      console.error("Performance page initialization failed:", error);
      if (error.code === "AUTH_REQUIRED") {
        window.location.assign("../teacher_registration/login.html");
        return;
      }
      renderError(error.message || "Performance data could not be loaded.");
    }
    $("classSelector").addEventListener("change", () => void selectScope());
    $("streamSelector").addEventListener("change", () => void selectScope());
    $("subjectSelector").addEventListener("change", () => void selectSubject());
    $("studentSearch").addEventListener("input", (event) => {
      state.query = event.target.value.trim().toLowerCase();
      state.page = 1;
      renderTable();
    });
    $("categoryFilter").addEventListener("change", (event) => {
      state.category = event.target.value;
      state.page = 1;
      renderTable();
    });
    $("sortPerformance").addEventListener("change", (event) => {
      state.sort = event.target.value;
      state.page = 1;
      renderTable();
    });
    $("pageButtons").addEventListener("click", (event) => {
      const page = Number(event.target.dataset.page);
      if (page) {
        state.page = page;
        renderTable();
      }
    });
    $("performanceBody").addEventListener("click", (event) => {
      const student = event.target.closest("[data-student]")?.dataset.student;
      if (student) openDrawer(student);
    });
    $("performanceDrawer").addEventListener("click", (event) => {
      if (event.target.closest("[data-close]") || event.target.classList.contains("performance-drawer-backdrop")) {
        $("performanceDrawer").replaceChildren();
      }
    });
    window.addEventListener("beforeunload", () => state.stopRealtime(), { once: true });
  });
})();
