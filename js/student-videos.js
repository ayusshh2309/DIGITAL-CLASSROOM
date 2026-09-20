(() => {
  const state = { videos: [], student: {}, channel: null, activeVideo: null };
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  const profileKeys = ["studentProfile", "studentData", "finalStudentRegistration"];

  function readProfile() {
    const profiles = profileKeys.map((key) => {
      try {
        return JSON.parse(localStorage.getItem(key) || "null");
      } catch (error) {
        console.warn(`Could not read ${key}.`, error);
        return null;
      }
    });
    return profiles.find((profile) => profile && (profile.classGrade || profile.class_grade)) || profiles.find(Boolean) || {};
  }

  function client() {
    return window.TeacherData?.getSupabaseClient?.() || window.SmartLearningSupabase?.getClient?.();
  }

  function subjectNames(profile) {
    const grade = String(profile.classGrade || profile.class_grade || profile.grade || "");
    const stream = String(profile.stream || profile.classStream || "").toLowerCase();
    const standard = { "5": ["English", "Mathematics", "EVS", "Hindi"], "6": ["English", "Mathematics", "Science", "Social Science", "Hindi"], "7": ["English", "Mathematics", "Science", "Social Science", "Hindi"], "8": ["English", "Mathematics", "Science", "Social Science", "Hindi"], "9": ["English", "Mathematics", "Science", "Social Science", "Hindi"], "10": ["English", "Mathematics", "Science", "Social Science", "Hindi"] };
    const streams = { science_pcm: ["Physics", "Chemistry", "Mathematics"], science_pcb: ["Physics", "Chemistry", "Biology"], commerce: ["Accountancy", "Business Studies", "Economics"], arts: ["History", "Political Science", "Geography", "Sociology"] };
    return grade === "11" || grade === "12" ? [...(streams[stream] || []), "English", "Computer Science", "Physical Education"] : (standard[grade] || []);
  }

  function typeOf(video) { return String(video.material_type || video.type || "").toLowerCase(); }
  function urlOf(video) { return video.video_url || video.external_url || video.file_url || ""; }
  function dateOf(video) { return new Date(video.uploaded_at || video.updated_at || video.created_at || 0); }
  function colorFor(subject) { const value = String(subject || "").toLowerCase(); if (value.includes("chem")) return "green"; if (value.includes("math")) return "orange"; if (value.includes("english")) return "blue"; if (value.includes("physical")) return "pink"; if (value.includes("social")) return "teal"; if (value.includes("computer")) return "purple"; return "purple"; }
  function durationText(video) { if (video.duration) return String(video.duration); const seconds = Number(video.duration_seconds || 0); return seconds ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "--:--"; }
  function thumbnail(video) { return video.thumbnail_url || video.thumbnail || ""; }
  function subjectIcon(subject) { const value = String(subject || "").toLowerCase(); if (value.includes("physics")) return "fa-atom"; if (value.includes("chem")) return "fa-flask"; if (value.includes("math")) return "fa-calculator"; if (value.includes("computer")) return "fa-code"; return "fa-book"; }

  function availableSubjects() { return [...new Set(subjectNames(state.student))].sort(); }

  function renderSubjectControls() {
    const subjects = availableSubjects();
    const filter = $("subjectFilter");
    const current = filter.value || "All";
    filter.innerHTML = '<option value="All">All Subjects</option>' + subjects.map((subject) => `<option value="${escape(subject)}">${escape(subject)}</option>`).join("");
    filter.value = subjects.includes(current) ? current : "All";
    document.querySelectorAll(".subject-tab[data-subject]").forEach((tab) => {
      const subject = tab.dataset.subject;
      if (subject !== "All") tab.hidden = !subjects.some((item) => item.toLowerCase() === subject.toLowerCase());
    });
  }

  function filteredVideos() {
    const query = $("searchInput").value.trim().toLowerCase();
    const subject = $("subjectFilter").value;
    const videos = state.videos.filter((video) => {
      const searchable = [video.title, video.subject, video.chapter, video.topic, video.teacher_name, video.description].join(" ").toLowerCase();
      return (!query || searchable.includes(query)) && (subject === "All" || video.subject === subject);
    });
    const sort = $("sortFilter").value;
    return videos.sort((left, right) => sort === "oldest" ? dateOf(left) - dateOf(right) : sort === "az" ? String(left.title || "").localeCompare(String(right.title || "")) : sort === "duration" ? Number(right.duration_seconds || 0) - Number(left.duration_seconds || 0) : dateOf(right) - dateOf(left));
  }

  function renderVideos() {
    renderSubjectControls();
    const grid = $("videoGrid");
    const empty = $("noResults");
    const videos = filteredVideos();
    grid.querySelectorAll(".video-card").forEach((card) => card.remove());
    empty.style.display = videos.length ? "none" : "block";
    videos.forEach((video) => {
      const id = escape(video.material_id || video.id);
      const color = colorFor(video.subject);
      const preview = thumbnail(video);
      const card = document.createElement("article");
      card.className = "video-card";
      card.innerHTML = `<div class="thumbnail">${preview ? `<img src="${escape(preview)}" alt="${escape(video.title)}">` : `<i class="fa-solid fa-video" style="color:white;font-size:30px" aria-hidden="true"></i>`}<button class="play-button" data-watch="${id}" aria-label="Play video"><i class="fa-solid fa-play"></i></button><span class="duration">${escape(durationText(video))}</span><div class="card-menu"><button class="card-menu-button" data-menu="${id}" aria-label="Video options"><i class="fa-solid fa-ellipsis-vertical"></i></button><div class="card-dropdown" id="dropdown-${id}"><button data-save="${id}"><i class="fa-regular fa-bookmark"></i> &nbsp; Save</button><button data-share="${id}"><i class="fa-solid fa-share-nodes"></i> &nbsp; Share</button></div></div></div><span class="video-subject subject-${color}"><i class="fa-solid ${subjectIcon(video.subject)}"></i>&nbsp; ${escape(video.subject || "General")}</span><h3 class="video-title" title="${escape(video.title)}">${escape(video.title || "Untitled Video")}</h3><p class="video-description">${escape(video.description || video.chapter || video.topic || "")}</p><div class="video-footer"><div class="video-meta"><span class="meta-item"><i class="fa-solid fa-circle-play"></i>${escape(video.teacher_name || video.subject || "Video")}</span><span class="meta-item"><i class="fa-regular fa-clock"></i>${escape(durationText(video))}</span></div><button class="watch-button watch-${color}" data-watch="${id}"><i class="fa-solid fa-play"></i> Watch</button></div>`;
      grid.insertBefore(card, empty);
    });
    $("totalVideos").textContent = videos.length;
    $("totalProgress").style.width = `${state.videos.length ? Math.round((videos.length / state.videos.length) * 100) : 0}%`;
  }

  function findVideo(id) { return state.videos.find((video) => String(video.material_id || video.id) === String(id)); }

  function openVideo(id) {
    const video = findVideo(id);
    if (!video || !urlOf(video)) return;
    state.activeVideo = video;
    $("modalThumbnail").src = thumbnail(video);
    $("modalTitle").textContent = video.title || "Video";
    $("modalDescription").textContent = video.description || video.chapter || video.topic || "";
    $("modalPlay").onclick = () => playActiveVideo();
    $("videoModal").classList.add("show");
    closeAllDropdowns();
  }

  function playActiveVideo() {
    const video = state.activeVideo;
    if (!video || !urlOf(video)) return;
    const area = document.querySelector(".modal-video-area");
    const image = $("modalThumbnail");
    const play = $("modalPlay");
    image.hidden = true;
    play.hidden = true;
    let player = area.querySelector("video[data-material-video]");
    if (!player) { player = document.createElement("video"); player.dataset.materialVideo = "true"; player.controls = true; player.autoplay = true; player.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000"; area.insertBefore(player, play); }
    player.src = urlOf(video);
    player.currentTime = Number(video.watch_position || 0);
    player.onloadedmetadata = () => { if (video.watch_position) player.currentTime = Number(video.watch_position); };
    player.ontimeupdate = () => saveProgress(video, player);
  }

  async function saveProgress(video, player) {
    const supabase = client();
    if (!supabase || !player.duration) return;
    if (Math.floor(player.currentTime) % 5 !== 0) return;
    await supabase.rpc("save_student_video_progress", { requested_video_id: video.material_id || video.id, requested_position: player.currentTime, requested_duration: player.duration, requested_completed: player.ended }).catch(() => {});
  }

  function closeVideoModal() { const player = document.querySelector("video[data-material-video]"); if (player) player.pause(); $("videoModal").classList.remove("show"); }
  function closeAllDropdowns() { document.querySelectorAll(".card-dropdown").forEach((dropdown) => dropdown.classList.remove("show")); }

  async function loadVideos() {
    state.student = readProfile();
    renderVideos();
    const supabase = client();
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    state.student.student_id = user.id;
    const { data, error } = await supabase.rpc("get_student_videos", { requested_student_id: user.id });
    if (error) { console.warn("Could not load authorized videos.", error); return; }
    state.videos = (data || []).filter((video) => typeOf(video) === "video");
    renderVideos();
    state.channel?.unsubscribe();
    state.channel = supabase.channel(`student-videos-${user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "materials" }, loadVideos).subscribe();
  }

  window.closeVideoModal = closeVideoModal;
  document.addEventListener("DOMContentLoaded", () => {
    $("searchInput").addEventListener("input", renderVideos);
    $("subjectFilter").addEventListener("change", renderVideos);
    $("sortFilter").addEventListener("change", renderVideos);
    $("videoGrid").addEventListener("click", (event) => {
      const target = event.target.closest("[data-watch], [data-menu], [data-save], [data-share]");
      if (!target) return;
      const id = target.dataset.watch || target.dataset.menu || target.dataset.save || target.dataset.share;
      if (target.dataset.watch) return openVideo(id);
      if (target.dataset.menu) { event.stopPropagation(); document.getElementById(`dropdown-${id}`)?.classList.toggle("show"); return; }
      const video = findVideo(id);
      if (target.dataset.save && video) alert(`"${video.title}" has been saved.`);
      if (target.dataset.share && video) navigator.clipboard?.writeText(video.title);
      closeAllDropdowns();
    });
    document.querySelectorAll(".subject-tab").forEach((tab) => tab.addEventListener("click", () => { document.querySelectorAll(".subject-tab").forEach((item) => item.classList.remove("active")); tab.classList.add("active"); $("subjectFilter").value = tab.dataset.subject; renderVideos(); }));
    $("videoModal").addEventListener("click", (event) => { if (event.target === $("videoModal")) closeVideoModal(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeVideoModal(); closeAllDropdowns(); } });
    loadVideos().catch((error) => { console.warn("Videos are unavailable.", error); state.videos = []; renderVideos(); });
  });
})();
