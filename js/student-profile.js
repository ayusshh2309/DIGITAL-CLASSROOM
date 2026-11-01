(() => {
  const FALLBACK = "Not provided";
  const PHOTO_BUCKET = "student-profile-images";
  const STUDENT_COLUMNS = [
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
    "profile_photo_url",
    "grade",
    "stream",
    "school_name",
    "board",
    "academic_year",
    "medium_of_instruction",
  ].join(", ");

  let profileChannel = null;

  function displayValue(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return FALLBACK;
    }
    return String(value);
  }

  function streamLabel(stream) {
    return String(stream || "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function setProfileField(field, value) {
    document
      .querySelectorAll(`[data-profile-field="${field}"]`)
      .forEach((node) => {
        node.textContent = displayValue(value);
      });
  }

  function setMessage(message = "") {
    const node = document.getElementById("profileLoadMessage");
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
  }

  function renderStudent(student) {
    const grade = Number(student.grade);
    const hasGrade = Number.isInteger(grade);
    const academicStream = hasGrade && grade >= 11
      ? streamLabel(student.stream) || FALLBACK
      : "Not applicable";
    const classValue = hasGrade ? `Class ${grade}` : FALLBACK;
    const studentId = displayValue(student.student_id);
    const name = displayValue(student.full_name);

    const accountStatus = document.getElementById("account");
    if (accountStatus) {
      accountStatus.classList.remove("unavailable");
      const heading = accountStatus.querySelector("h4");
      const description = accountStatus.querySelector("p");
      const badge = accountStatus.querySelector(".verified");
      if (heading) heading.textContent = "Student Account Active";
      if (description) description.textContent = "Your registered student account is connected.";
      if (badge) badge.textContent = "ACTIVE";
    }

    document.querySelectorAll(".page-header .profile-user-name").forEach((node) => {
      node.textContent = name;
    });
    document.querySelectorAll(".banner-student-id, .student-id-box .id").forEach((node) => {
      node.textContent = studentId;
    });

    const gradeBadge = document.querySelector(".profile-grade-badge");
    if (gradeBadge) {
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-graduation-cap";
      const badgeText = hasGrade
        ? ` ${classValue}${grade >= 11 && student.stream ? ` • ${streamLabel(student.stream)}` : ""}`
        : ` ${FALLBACK}`;
      gradeBadge.replaceChildren(icon, document.createTextNode(badgeText));
    }

    const personalFields = {
      full_name: student.full_name,
      student_id: student.student_id,
      date_of_birth: student.date_of_birth,
      gender: student.gender,
      email: student.email,
      phone: student.phone,
      father_name: student.father_name,
      father_phone: student.father_phone,
      mother_name: student.mother_name,
      mother_phone: student.mother_phone,
    };
    Object.entries(personalFields).forEach(([field, value]) => {
      setProfileField(field, value);
    });

    const academicFields = {
      grade: classValue,
      stream: academicStream,
      board: student.board ? String(student.board).toUpperCase() : student.board,
      academic_year: student.academic_year,
      medium_of_instruction: student.medium_of_instruction,
      school_name: student.school_name,
    };
    Object.entries(academicFields).forEach(([field, value]) => {
      setProfileField(field, value);
    });

    const contactValues = [
      student.email,
      student.phone,
      student.school_name,
      student.academic_year,
    ];
    document.querySelectorAll(".contact-item span").forEach((node, index) => {
      node.textContent = displayValue(contactValues[index]);
    });
    document.querySelectorAll(".header-meta-item span:last-child").forEach((node, index) => {
      node.textContent = displayValue(contactValues[index]);
    });
  }

  async function renderProfilePhoto(client, photoPath) {
    const avatar = document.querySelector(".header-avatar");
    if (!avatar) return;
    avatar.hidden = true;
    avatar.removeAttribute("src");
    if (!photoPath) return;

    let photoUrl = photoPath;
    if (!/^https?:\/\//i.test(photoPath)) {
      const { data, error } = await client.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(photoPath, 3600);
      if (error) throw error;
      photoUrl = data.signedUrl;
    }

    avatar.addEventListener("error", () => {
      avatar.hidden = true;
      setMessage("Your profile details loaded, but the registered profile photo could not be displayed.");
      console.error("The registered student profile photo could not be displayed.");
    }, { once: true });
    avatar.src = photoUrl;
    avatar.hidden = false;
  }

  function renderSubjects(subjects) {
    const list = document.querySelector(".subjects-list");
    const count = document.querySelector(".information-card .information-header > span");
    if (!list) return;

    list.replaceChildren();
    subjects.forEach((subject, index) => {
      const item = document.createElement("span");
      item.className = `subject ${["", "blue", "green", "orange"][index % 4]}`.trim();
      item.textContent = streamLabel(subject.name);
      list.appendChild(item);
    });
    if (!subjects.length) {
      const empty = document.createElement("span");
      empty.className = "detail-value";
      empty.textContent = FALLBACK;
      list.appendChild(empty);
    }
    if (count) {
      count.textContent = `${subjects.length} Subject${subjects.length === 1 ? "" : "s"}`;
    }
  }

  async function loadSubjects(client, student) {
    try {
      const curriculum = await window.StudentCurriculum.loadForStudent(client, student);
      renderSubjects(curriculum.subjects);
    } catch (error) {
      console.error("Student profile subjects could not be loaded.", error);
      const list = document.querySelector(".subjects-list");
      if (list) list.textContent = "Subjects could not be loaded.";
      const card = [...document.querySelectorAll(".information-card")]
        .find((item) => item.querySelector("h2")?.textContent.includes("Enrolled Subjects"));
      const count = card?.querySelector(".information-header > span");
      if (count) count.textContent = "Unavailable";
    }
  }

  function subscribeToStudent(client, userId) {
    if (profileChannel || !client.channel) return;
    profileChannel = client
      .channel(`student-profile-${userId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "students",
        filter: `user_id=eq.${userId}`,
      }, () => void loadProfile())
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "subjects",
      }, () => void loadProfile())
      .subscribe((status) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          console.error("Student profile realtime updates are unavailable.", status);
        }
      });
  }

  async function loadProfile() {
    try {
      const client = window.SmartLearningSupabase?.getClient?.();
      if (!client) throw new Error("Supabase is not configured.");

      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError) throw authError;
      const user = authData?.user;
      if (!user) throw new Error("Sign in to view your student profile.");

      const { data: student, error: studentError } = await client
        .from("students")
        .select(STUDENT_COLUMNS)
        .eq("user_id", user.id)
        .maybeSingle();
      if (studentError) throw studentError;
      if (!student) throw new Error("No student profile is linked to this account.");

      renderStudent(student);
      setMessage("");
      try {
        await renderProfilePhoto(client, student.profile_photo_url);
      } catch (error) {
        console.error("Student profile photo could not be loaded.", error);
        setMessage("Your profile details loaded, but the registered profile photo could not be loaded.");
      }
      await loadSubjects(client, student);
      subscribeToStudent(client, user.id);
    } catch (error) {
      console.error("Student profile could not be loaded.", error);
      const accountStatus = document.getElementById("account");
      accountStatus?.classList.add("unavailable");
      const heading = accountStatus?.querySelector("h4");
      const description = accountStatus?.querySelector("p");
      const badge = accountStatus?.querySelector(".verified");
      if (heading) heading.textContent = "Account status unavailable";
      if (description) description.textContent = "Your student account could not be verified.";
      if (badge) badge.textContent = "UNAVAILABLE";
      setMessage(error.message || "Student profile could not be loaded.");
    }
  }

  document.querySelectorAll(".profile-tab[onclick]").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".profile-tab").forEach((item) => {
        item.classList.toggle("active", item === tab);
      });
    });
  });

  window.scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  window.addEventListener("beforeunload", () => {
    if (profileChannel) {
      window.SmartLearningSupabase?.getClient?.()?.removeChannel(profileChannel);
    }
  });

  loadProfile();
})();
