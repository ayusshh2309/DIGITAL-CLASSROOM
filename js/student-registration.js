(() => {
  const STREAMS = {
    science_pcm: "Science (PCM)",
    science_pcb: "Science (PCB)",
    commerce: "Commerce",
    arts_humanities: "Arts / Humanities",
  };
  const GRADES = new Set([5, 6, 7, 8, 9, 10, 11, 12]);
  const $ = (id) => document.getElementById(id);
  const normalized = (value) => String(value ?? "").trim();

  function draft() {
    return window.StudentData?.getStudentDraft?.() || {};
  }

  function saveDraft(values) {
    return window.StudentData.saveStudentDraft(values);
  }

  function phoneValue(code, number) {
    return [normalized(code), normalized(number).replace(/[^\d]/g, "")].filter(Boolean).join(" ");
  }

  function showMessage(message, type = "error") {
    const element = $("registrationMessage");
    if (!element) return;
    element.textContent = message;
    element.className = `message ${type}`;
    element.style.display = "block";
    element.setAttribute("role", type === "error" ? "alert" : "status");
  }

  function validatePersonal(data) {
    const required = [
      ["fullName", "Full name is required."],
      ["email", "Email address is required."],
      ["phone", "Phone number is required."],
      ["dob", "Date of birth is required."],
      ["fatherName", "Father's name is required."],
      ["fatherPhone", "Father's phone number is required."],
      ["motherName", "Mother's name is required."],
      ["motherPhone", "Mother's phone number is required."],
      ["gender", "Gender is required."],
      ["country", "Country is required."],
      ["state", "State or province is required."],
      ["city", "City is required."],
      ["address", "Address is required."],
      ["password", "Password is required."],
      ["confirmPassword", "Please confirm your password."],
    ];
    const missing = required.find(([key]) => !normalized(data[key]));
    if (missing) return missing[1];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return "Enter a valid email address.";
    if (normalized(data.dob) > new Date().toISOString().slice(0, 10)) return "Date of birth cannot be in the future.";
    for (const field of ["phone", "fatherPhone", "motherPhone"]) {
      const number = normalized(data[field]).replace(/\D/g, "");
      if (number.length < 7 || number.length > 15) return "Enter a valid phone number.";
    }
    if (data.password.length < 8) return "Password must contain at least 8 characters.";
    if (data.password !== data.confirmPassword) return "Passwords do not match.";
    return "";
  }

  function collectPersonal() {
    const values = {};
    [
      "fullName", "email", "phone", "dob", "fatherName", "fatherPhone",
      "motherName", "motherPhone", "gender", "country", "state", "city",
      "address", "password", "confirmPassword", "countryCode",
      "fatherCountryCode", "motherCountryCode",
    ].forEach((id) => { values[id] = normalized($(id)?.value); });
    return values;
  }

  function initializePersonal() {
    const current = draft();
    [
      "fullName", "email", "phone", "dob", "fatherName", "fatherPhone",
      "motherName", "motherPhone", "gender", "country", "state", "city",
      "address", "password", "confirmPassword", "countryCode",
      "fatherCountryCode", "motherCountryCode",
    ].forEach((id) => {
      if ($(id) && current[id] !== undefined) $(id).value = current[id];
    });
    if (current.profilePhoto) {
      $("uploadText").innerHTML = "<strong>Photo selected</strong><br />Your profile image is ready to review.";
    }

    $("profilePhotoInput").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/gif"].includes(file.type) || file.size > 2 * 1024 * 1024) {
        window.alert("Choose a JPG, PNG, or GIF image smaller than 2MB.");
        event.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        saveDraft({ profilePhoto: String(reader.result || "") });
        $("uploadText").innerHTML = "<strong>Photo selected</strong><br />Your profile image is ready to review.";
      });
      reader.addEventListener("error", () => window.alert("Could not read this profile photo. Please choose another file."));
      reader.readAsDataURL(file);
    });

    $("studentForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = collectPersonal();
      const validationError = validatePersonal(values);
      if (validationError) {
        window.alert(validationError);
        return;
      }
      saveDraft(values);
      $("studentNextBtn").textContent = "Saved. Opening academic details...";
      window.location.assign("academic.html");
    });
  }

  function initializeAcademic() {
    const classSelect = $("classGrade");
    const streamSelect = $("stream");
    const current = draft();
    ["classGrade", "stream", "schoolName", "board", "academicYear", "rollNumber"].forEach((id) => {
      if ($(id) && current[id] !== undefined && current[id] !== null) $(id).value = current[id];
    });
    if (current.medium) {
      const radio = [...document.querySelectorAll('input[name="medium"]')]
        .find((option) => option.value === current.medium);
      if (radio) radio.checked = true;
    }

    function updateStreamVisibility() {
      const requiresStream = ["11", "12"].includes(classSelect.value);
      $("streamContainer").classList.toggle("hidden", !requiresStream);
      streamSelect.required = requiresStream;
      if (!requiresStream) streamSelect.value = "";
    }
    updateStreamVisibility();
    classSelect.addEventListener("change", updateStreamVisibility);

    $("academicForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const grade = Number(classSelect.value);
      const stream = streamSelect.value || null;
      const medium = document.querySelector('input[name="medium"]:checked')?.value || "";
      if (!GRADES.has(grade)) {
        window.alert("Select a valid class or grade.");
        return;
      }
      if ((grade === 11 || grade === 12) && !Object.hasOwn(STREAMS, stream)) {
        window.alert("Select a valid stream for this grade.");
        return;
      }
      if (grade < 11 && stream !== null) {
        window.alert("Streams are only available for Grades 11 and 12.");
        return;
      }
      if (!normalized($("schoolName").value) || !$("board").value || !$("academicYear").value || !medium) {
        window.alert("Complete all required academic information.");
        return;
      }
      saveDraft({
        classGrade: String(grade),
        stream: grade >= 11 ? stream : null,
        schoolName: normalized($("schoolName").value),
        board: $("board").value,
        academicYear: $("academicYear").value,
        rollNumber: normalized($("rollNumber").value),
        medium,
      });
      window.location.assign("st_review.html");
    });
  }

  function appendReviewRow(container, label, value) {
    if (value === null || value === undefined || value === "") return;
    const row = document.createElement("div");
    row.className = "review-row";
    const key = document.createElement("span");
    key.className = "review-label";
    key.textContent = label;
    const content = document.createElement("span");
    content.className = "review-value";
    content.textContent = String(value);
    row.append(key, content);
    container.appendChild(row);
  }

  function renderReview(data) {
    const personal = $("personalInfoContainer");
    const profile = $("profileInfoContainer");
    const academic = $("academicInfoContainer");
    const other = $("otherInfoContainer");
    personal.replaceChildren();
    profile.replaceChildren();
    academic.replaceChildren();
    other.replaceChildren();
    appendReviewRow(personal, "Full Name", data.fullName);
    appendReviewRow(personal, "Email Address", data.email);
    appendReviewRow(personal, "Phone Number", phoneValue(data.countryCode, data.phone));
    appendReviewRow(personal, "Date of Birth", data.dob);
    appendReviewRow(personal, "Gender", data.gender);
    appendReviewRow(personal, "Father's Name", data.fatherName);
    appendReviewRow(personal, "Father's Phone", phoneValue(data.fatherCountryCode, data.fatherPhone));
    appendReviewRow(personal, "Mother's Name", data.motherName);
    appendReviewRow(personal, "Mother's Phone", phoneValue(data.motherCountryCode, data.motherPhone));
    if (data.profilePhoto) {
      const group = document.createElement("div");
      group.className = "profile-photo-group";
      const label = document.createElement("span");
      label.className = "review-label";
      label.textContent = "Profile Photo";
      const image = document.createElement("img");
      image.className = "uploaded-photo-preview";
      image.alt = "Profile Preview";
      image.src = data.profilePhoto;
      group.append(label, image);
      profile.appendChild(group);
    }
    appendReviewRow(profile, "Address", data.address);
    appendReviewRow(profile, "City", data.city);
    appendReviewRow(profile, "State", data.state);
    appendReviewRow(profile, "Country", data.country);
    appendReviewRow(academic, "Class / Grade", data.classGrade ? `Class ${data.classGrade}` : "");
    appendReviewRow(academic, "Stream", data.stream ? STREAMS[data.stream] : "Not applicable");
    appendReviewRow(academic, "School Name", data.schoolName);
    appendReviewRow(academic, "Board", data.board ? data.board.toUpperCase() : "");
    appendReviewRow(academic, "Academic Year", data.academicYear);
    appendReviewRow(academic, "Medium of Instruction", data.medium);
    appendReviewRow(other, "Roll Number", data.rollNumber);
    appendReviewRow(other, "Student ID", "Will be generated after successful registration");
  }

  function validateCompleteDraft(data) {
    const personalError = validatePersonal(data);
    if (personalError) return personalError;
    const grade = Number(data.classGrade);
    if (!GRADES.has(grade)) return "Select a valid class or grade.";
    if (grade >= 11 && !Object.hasOwn(STREAMS, data.stream)) return "Select a valid stream for this grade.";
    if (grade < 11 && data.stream) return "Streams are not available for this grade.";
    for (const [key, message] of [
      ["schoolName", "School name is required."],
      ["board", "Board is required."],
      ["academicYear", "Academic year is required."],
      ["medium", "Medium of instruction is required."],
    ]) {
      if (!normalized(data[key])) return message;
    }
    return "";
  }

  function isDuplicateEmailError(error) {
    return error?.code === "user_already_exists" || /already (registered|exists)|user already exists/i.test(error?.message || "");
  }

  function friendlyAuthError(error) {
    if (isDuplicateEmailError(error)) return "An account already exists for this email. Use its password to continue registration, or sign in.";
    if (/weak_password|password.*(short|weak)/i.test(error?.message || "")) return "Password must contain at least 8 characters.";
    if (/password/i.test(error?.message || "")) return "Password was rejected. Check the password and try again.";
    if (/email/i.test(error?.message || "")) return "Check the email address and try again.";
    return "Could not create or verify the account. Please check your connection and try again.";
  }

  async function uploadPhoto(client, userId, photoData) {
    const [metadata, encoded] = String(photoData).split(",");
    const mime = metadata.match(/^data:(image\/(?:jpeg|png|gif));base64$/)?.[1];
    if (!mime || !encoded) throw new Error("The selected profile photo is invalid. Choose a JPG, PNG, or GIF image.");
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" }[mime];
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("The selected profile photo exceeds the 2MB limit.");
    const path = `${userId}/profile-${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage.from("student-profile-images").upload(path, new Blob([bytes], { type: mime }), {
      contentType: mime,
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  async function getOrCreateAuthUser(client, data) {
    const { data: currentAuth, error: currentError } = await client.auth.getUser();
    if (currentError) throw currentError;
    if (currentAuth?.user) {
      if (currentAuth.user.email?.toLowerCase() !== data.email.toLowerCase()) {
        throw new Error("A different account is signed in. Sign out before creating this student account.");
      }
      return currentAuth.user;
    }

    const { data: signup, error: signupError } = await client.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: { role: "student", full_name: data.fullName },
        emailRedirectTo: new URL("st_review.html", window.location.href).href,
      },
    });
    if (signupError && !isDuplicateEmailError(signupError)) {
      console.error("Student Supabase Auth signup failed.", signupError);
      throw new Error(friendlyAuthError(signupError));
    }
    if (signupError || !signup?.session) {
      const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (!signInError && signedIn?.user) return signedIn.user;
      if (signup?.user && !signupError && !signup.session) {
        throw new Error("Account created. Verify your email, then return to this page and click Create Account again to finish registration.");
      }
      if (/not confirmed|email not confirmed/i.test(signInError?.message || "")) {
        throw new Error("This account needs email verification. Confirm the link we sent, then return here and click Create Account again.");
      }
      if (isDuplicateEmailError(signupError)) {
        throw new Error("An account already exists for this email. Check the password, or sign in to that account before continuing.");
      }
      console.error("Student Supabase Auth sign-in after signup failed.", signInError);
      throw new Error(friendlyAuthError(signInError));
    }
    if (!signup.user) throw new Error("Supabase did not return the newly created account.");

    const { data: verified, error: verifyError } = await client.auth.getUser();
    if (verifyError) {
      console.error("Could not verify the new student Auth user.", verifyError);
      throw new Error("The new account could not be verified. Please try again.");
    }
    if (!verified?.user?.id || verified.user.id !== signup.user.id) {
      throw new Error("Could not verify the new account. Please try again.");
    }
    return verified.user;
  }

  async function createStudentProfile(client, user, data) {
    const { data: existing, error: lookupError } = await client.from("students")
      .select("id, student_id, profile_photo_url")
      .eq("user_id", user.id)
      .maybeSingle();
    if (lookupError) {
      console.error("Could not check for an existing student profile.", lookupError);
      throw new Error("Could not check your student profile. Your temporary draft is preserved; please try again.");
    }
    if (existing) return existing;

    const payload = {
      user_id: user.id,
      full_name: data.fullName,
      email: data.email,
      phone: phoneValue(data.countryCode, data.phone),
      date_of_birth: data.dob,
      gender: data.gender,
      father_name: data.fatherName,
      father_phone: phoneValue(data.fatherCountryCode, data.fatherPhone),
      mother_name: data.motherName,
      mother_phone: phoneValue(data.motherCountryCode, data.motherPhone),
      country: data.country,
      state: data.state,
      city: data.city,
      address: data.address,
      profile_photo_url: null,
      grade: Number(data.classGrade),
      stream: Number(data.classGrade) >= 11 ? data.stream : null,
      school_name: data.schoolName,
      board: data.board,
      academic_year: data.academicYear,
      roll_number: data.rollNumber || null,
      medium_of_instruction: data.medium,
    };
    const { data: inserted, error: insertError } = await client.from("students")
      .insert(payload)
      .select("id, student_id, profile_photo_url")
      .single();
    if (insertError) {
      console.error("Could not insert the student profile.", insertError);
      throw new Error("Could not save your student profile. Your account is safe and your temporary draft is preserved; please try again.");
    }
    return inserted;
  }

  async function completeRegistration(data) {
    const client = window.SmartLearningSupabase?.getClient?.();
    if (!client) throw new Error("Supabase is not configured. Please try again later.");
    showMessage("Creating account...", "status");
    const user = await getOrCreateAuthUser(client, data);

    showMessage("Creating student profile...", "status");
    const profile = await createStudentProfile(client, user, data);
    let photoWarning = "";
    if (data.profilePhoto && !profile.profile_photo_url) {
      showMessage("Uploading profile photo...", "status");
      try {
        const photoPath = await uploadPhoto(client, user.id, data.profilePhoto);
        const { error } = await client.from("students")
          .update({ profile_photo_url: photoPath })
          .eq("id", profile.id)
          .eq("user_id", user.id);
        if (error) {
          const { error: removeError } = await client.storage.from("student-profile-images").remove([photoPath]);
          if (removeError) console.error("Could not remove an unreferenced student photo.", removeError);
          throw error;
        }
      } catch (error) {
        console.error("Optional student profile photo upload failed.", error);
        photoWarning = " Your account was created, but the optional profile photo could not be uploaded.";
      }
    }

    showMessage("Finalizing registration...", "status");
    window.StudentData.clearStudentRegistration();
    showMessage(`Account created successfully. Your Student ID is ${profile.student_id}.${photoWarning}`, photoWarning ? "warning" : "success");
    window.setTimeout(() => window.location.assign("../student_content/st_dashboard.html"), 1800);
  }

  function initializeReview() {
    const data = draft();
    renderReview(data);
    $("submitRegistrationBtn").addEventListener("click", async (event) => {
      event.preventDefault();
      const button = $("submitRegistrationBtn");
      const validationError = validateCompleteDraft(draft());
      if (validationError) {
        showMessage(validationError);
        return;
      }
      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = "Creating account...";
      try {
        await completeRegistration(draft());
      } catch (error) {
        console.error("Student registration failed.", error);
        showMessage(error.message || "Registration failed. Your temporary draft is preserved; please try again.");
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if ($("studentForm")) initializePersonal();
    else if ($("academicForm")) initializeAcademic();
    else if ($("submitRegistrationBtn")) initializeReview();
  });
})();
