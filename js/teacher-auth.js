(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const el = {
      themeBtn: document.getElementById('themeBtn'),
      loginTab: document.getElementById('loginTab'),
      signupTab: document.getElementById('signupTab'),
      loginEmail: document.getElementById('loginEmail'),
      loginPassword: document.getElementById('loginPassword'),
      toggleLoginPw: document.getElementById('toggleLoginPw'),
      forgotBtn: document.getElementById('forgotBtn'),
      loginBtn: document.getElementById('loginBtn'),
      loginStatus: document.getElementById('loginStatus'),
      googleLoginBtn: document.getElementById('googleLoginBtn'),
      microsoftLoginBtn: document.getElementById('microsoftLoginBtn'),
      fullName: document.getElementById('fullName'),
      workEmail: document.getElementById('workEmail'),
      countryPrefix: document.getElementById('countryPrefix'),
      phone: document.getElementById('phone'),
      signupPassword: document.getElementById('signupPassword'),
      toggleSignupPw: document.getElementById('toggleSignupPw'),
      strengthBar: document.getElementById('strengthBar'),
      pill8: document.getElementById('pill8'),
      pillUp: document.getElementById('pillUpper'),
      pillLo: document.getElementById('pillLower'),
      pillSp: document.getElementById('pillSpecial'),
      gradeGroup: document.getElementById('gradeGroup'),
      gradeGroupField: document.getElementById('gradeGroupField'),
      streamField: document.getElementById('streamField'),
      stream: document.getElementById('stream'),
      specialistField: document.getElementById('specialistField'),
      subjectChecklist: document.getElementById('subjectChecklist'),
      classMapContainer: document.getElementById('classMapContainer'),
      classMapGrid: document.getElementById('classMapGrid'),
      institution: document.getElementById('institution'),
      experience: document.getElementById('experience'),
      googleSignupBtn: document.getElementById('googleSignupBtn'),
      microsoftSignupBtn: document.getElementById('microsoftSignupBtn'),
      staffId: document.getElementById('staffId'),
      signupStatus: document.getElementById('signupStatus'),
      createAccountBtn: document.getElementById('createAccountBtn'),
      fileInput: document.getElementById('fileInput'),
      uploadBox: document.getElementById('uploadBox'),
      uploadName: document.getElementById('uploadName'),
    };

    function getTheme() {
      return localStorage.getItem('sl-theme') || 'light';
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      if (el.themeBtn) {
        el.themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
        el.themeBtn.setAttribute(
          'aria-label',
          theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
        );
      }
      localStorage.setItem('sl-theme', theme);
    }

    if (el.themeBtn) {
      el.themeBtn.addEventListener('click', function () {
        applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
      });
    }
    applyTheme(getTheme());

    function showLogin() {
      const loginSection = document.getElementById('loginSection');
      const signupSection = document.getElementById('signupSection');
      if (el.loginTab) el.loginTab.classList.add('active');
      if (el.signupTab) el.signupTab.classList.remove('active');
      if (loginSection) loginSection.classList.add('active');
      if (signupSection) signupSection.classList.remove('active');
      if (el.loginEmail) el.loginEmail.focus();
    }

    function showSignup() {
      const loginSection = document.getElementById('loginSection');
      const signupSection = document.getElementById('signupSection');
      if (el.signupTab) el.signupTab.classList.add('active');
      if (el.loginTab) el.loginTab.classList.remove('active');
      if (signupSection) signupSection.classList.add('active');
      if (loginSection) loginSection.classList.remove('active');
      if (el.fullName) el.fullName.focus();
    }

    if (el.loginTab) el.loginTab.addEventListener('click', showLogin);
    if (el.signupTab) el.signupTab.addEventListener('click', showSignup);

    const goSignupLink = document.getElementById('goSignup');
    if (goSignupLink) {
      goSignupLink.addEventListener('click', function (event) {
        event.preventDefault();
        showSignup();
      });
    }

    const goLoginLink = document.getElementById('goLogin');
    if (goLoginLink) {
      goLoginLink.addEventListener('click', function (event) {
        event.preventDefault();
        showLogin();
      });
    }

    showLogin();

    const SUBJECT_OPTIONS = [
      'Mathematics',
      'Science',
      'Physics',
      'Chemistry',
      'Biology',
      'English',
      'Hindi',
      'Social Science',
      'Computer Science',
      'History',
      'Geography',
    ];
    const CLASS_OPTIONS = ['5', '6', '7', '8', '9', '10', '11', '12'];

    function getSelectedTeachMode() {
      return document.querySelector('input[name="teachMode"]:checked')?.value || 'teachAll';
    }

    function renderSubjectChecklist() {
      if (!el.subjectChecklist) return;

      el.subjectChecklist.innerHTML = SUBJECT_OPTIONS.map(function (subject) {
        return `
          <label class="check-card">
            <input type="checkbox" value="${subject}" data-subject="${subject}" />
            <span>${subject}</span>
          </label>
        `;
      }).join('');
    }

    function renderClassMapGrid() {
      if (!el.classMapGrid) return;

      const selectedSubjects = Array.from(
        el.subjectChecklist.querySelectorAll('input[type="checkbox"]:checked')
      );

      if (!selectedSubjects.length) {
        el.classMapGrid.innerHTML = '<div class="empty-state">Select one or more subjects to assign classes.</div>';
        return;
      }

      const html = selectedSubjects.map(function (checkbox) {
        const subject = checkbox.value;
        return `
          <div class="class-map-row">
            <strong>${subject}</strong>
            <div class="class-row">
              ${CLASS_OPTIONS.map(function (grade) {
                return `
                  <label class="class-chip">
                    <input
                      type="checkbox"
                      value="${grade}"
                      data-subject="${subject}"
                    />
                    <span>${grade}</span>
                  </label>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('');

      el.classMapGrid.innerHTML = html;
    }

    function syncTeachingModeUI() {
      const mode = getSelectedTeachMode();
      const isSpecialist = mode === 'specialist';

      if (el.gradeGroupField) {
        el.gradeGroupField.style.display = isSpecialist ? 'none' : 'grid';
      }
      if (el.streamField) {
        const shouldShowStream = !isSpecialist && el.gradeGroup && el.gradeGroup.value === '11-12';
        el.streamField.style.display = shouldShowStream ? 'grid' : 'none';
      }
      if (el.specialistField) {
        el.specialistField.style.display = isSpecialist ? 'grid' : 'none';
      }
      if (el.classMapContainer) {
        el.classMapContainer.style.display = isSpecialist ? 'grid' : 'none';
      }

      if (isSpecialist) {
        renderSubjectChecklist();
        renderClassMapGrid();
      }
    }

    function showUploadedFileName(name) {
      if (!el.uploadName) return;
      el.uploadName.textContent = `✓ ${name}`;
      el.uploadName.style.display = 'block';
    }

    function setStatus(targetId, msg, type) {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.textContent = msg;
      target.className = 'status-msg ' + (type || 'info');
    }

    function clearStatus(targetId) {
      setStatus(targetId, '', 'info');
    }

    function setLoading(btn, on, text) {
      if (!btn) return;
      if (on) {
        btn.dataset.orig = btn.innerHTML;
        btn.innerHTML = '<span class="spinner"></span>' + (text || btn.textContent || 'Loading…');
        btn.disabled = true;
      } else {
        btn.innerHTML = btn.dataset.orig || (text || btn.textContent || 'Submit');
        btn.disabled = false;
      }
    }

    function togglePassword(targetId, btn) {
      const input = document.getElementById(targetId);
      if (!input || !btn) return;
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      btn.textContent = hidden ? 'Hide' : 'Show';
    }

    if (el.toggleLoginPw && el.loginPassword) {
      el.toggleLoginPw.addEventListener('click', function () {
        togglePassword('loginPassword', this);
      });
    }

    if (el.toggleSignupPw && el.signupPassword) {
      el.toggleSignupPw.addEventListener('click', function () {
        togglePassword('signupPassword', this);
      });
    }

    document.querySelectorAll('input[name="teachMode"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        syncTeachingModeUI();
      });
    });

    if (el.gradeGroup) {
      el.gradeGroup.addEventListener('change', function () {
        if (el.streamField) {
          const showStream = this.value === '11-12';
          el.streamField.style.display = showStream ? 'grid' : 'none';
        }
      });
    }

    if (el.subjectChecklist) {
      el.subjectChecklist.addEventListener('change', function (event) {
        const target = event.target;
        if (!target || target.type !== 'checkbox') return;
        renderClassMapGrid();
      });
    }

    if (el.uploadBox && el.fileInput) {
      el.uploadBox.addEventListener('click', function () {
        el.fileInput.click();
      });
      el.uploadBox.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          el.fileInput.click();
        }
      });
      el.uploadBox.addEventListener('dragover', function (event) {
        event.preventDefault();
        el.uploadBox.classList.add('dragover');
      });
      el.uploadBox.addEventListener('dragleave', function () {
        el.uploadBox.classList.remove('dragover');
      });
      el.uploadBox.addEventListener('drop', function (event) {
        event.preventDefault();
        el.uploadBox.classList.remove('dragover');
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        el.fileInput.files = event.dataTransfer.files;
        showUploadedFileName(file.name);
      });
      el.fileInput.addEventListener('change', function () {
        if (this.files && this.files[0]) {
          showUploadedFileName(this.files[0].name);
        }
      });
    }

    syncTeachingModeUI();

    function generateStaffId() {
      const used = JSON.parse(localStorage.getItem('sl_used_staff_ids') || '[]');
      let id = '';
      do {
        id = 'TCH' + Math.floor(100000 + Math.random() * 900000);
      } while (used.includes(id));
      used.push(id);
      localStorage.setItem('sl_used_staff_ids', JSON.stringify(used));
      return id;
    }

    function normalizeGradeGroup(value) {
      const map = {
        '5-6': 'grades_5_6',
        '7-8': 'grades_7_8',
        '9-10': 'grades_9_10',
        '11-12': 'grades_11_12',
      };
      return map[value] || null;
    }

    function getTeacherAssignment() {
      const mode = document.querySelector('input[name="teachMode"]:checked')?.value || 'teachAll';
      if (mode === 'teachAll') {
        const grade = el.gradeGroup ? el.gradeGroup.value : null;
        const stream = el.stream ? el.stream.value : null;
        const classesMap = {
          '5-6': ['5', '6'],
          '7-8': ['7', '8'],
          '9-10': ['9', '10'],
          '11-12': ['11', '12'],
        };
        const gradeClasses = classesMap[grade] || [];
        const subjects = grade === '11-12'
          ? (stream === 'PCM'
              ? ['Mathematics', 'Physics', 'Chemistry', 'English']
              : stream === 'PCB'
                ? ['Biology', 'Chemistry', 'Physics', 'English']
                : stream === 'Commerce'
                  ? ['Accountancy', 'Business Studies', 'Economics', 'English']
                  : ['History', 'Geography', 'Political Science', 'English'])
          : ['Mathematics', 'Science', 'English', 'Hindi', 'Social Science', 'Computer Science'];
        return {
          teaching_mode: 'teach_all',
          grade_group: normalizeGradeGroup(grade),
          stream: stream || null,
          subject_expertise: subjects,
          class_map: gradeClasses,
        };
      }

      const selected = Array.from(
        document.querySelectorAll('#subjectChecklist input[type="checkbox"]:checked')
      ).map((input) => input.value);

      const classMap = {};
      if (el.classMapGrid) {
        el.classMapGrid.querySelectorAll('input[type="checkbox"]:checked').forEach(function (input) {
          const subject = input.dataset.subject;
          if (!subject) return;
          if (!classMap[subject]) classMap[subject] = [];
          classMap[subject].push(input.value);
        });
      }

      return {
        teaching_mode: 'subject_specialist',
        grade_group: null,
        stream: null,
        subject_expertise: selected,
        class_map: classMap,
      };
    }

    function validateTeacherSignup() {
      const fullName = el.fullName ? el.fullName.value.trim() : '';
      const email = el.workEmail ? el.workEmail.value.trim() : '';
      const phone = el.phone ? el.phone.value.trim() : '';
      const institution = el.institution ? el.institution.value.trim() : '';
      const password = el.signupPassword ? el.signupPassword.value : '';
      const selectedMode = document.querySelector('input[name="teachMode"]:checked')?.value || 'teachAll';

      if (!fullName) {
        setStatus('signupStatus', 'Please enter your full name.', 'error');
        if (el.fullName) el.fullName.focus();
        return false;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) {
        setStatus('signupStatus', 'Please enter a valid work email.', 'error');
        if (el.workEmail) el.workEmail.focus();
        return false;
      }
      if (!phone || phone.replace(/\D/g, '').length < 7) {
        setStatus('signupStatus', 'Please enter a valid phone number.', 'error');
        if (el.phone) el.phone.focus();
        return false;
      }
      if (!institution) {
        setStatus('signupStatus', 'Please enter your institution name.', 'error');
        if (el.institution) el.institution.focus();
        return false;
      }
      if (
        password.length < 8 ||
        !/[A-Z]/.test(password) ||
        !/[a-z]/.test(password) ||
        !/[^A-Za-z0-9]/.test(password)
      ) {
        setStatus(
          'signupStatus',
          'Password needs 8+ chars, uppercase, lowercase, and a special character.',
          'error'
        );
        if (el.signupPassword) el.signupPassword.focus();
        return false;
      }

      if (selectedMode === 'teachAll') {
        const grade = el.gradeGroup ? el.gradeGroup.value : '';
        if (!grade) {
          setStatus('signupStatus', 'Please select a grade group.', 'error');
          if (el.gradeGroup) el.gradeGroup.focus();
          return false;
        }
        if (grade === '11-12' && (!el.stream || !el.stream.value)) {
          setStatus('signupStatus', 'Please select a stream for grades 11–12.', 'error');
          if (el.stream) el.stream.focus();
          return false;
        }
      } else {
        const selectedSubjects = Array.from(
          document.querySelectorAll('#subjectChecklist input[type="checkbox"]:checked')
        );
        if (!selectedSubjects.length) {
          setStatus('signupStatus', 'Please choose at least one subject.', 'error');
          return false;
        }

        for (const subjectCheck of selectedSubjects) {
          const subject = subjectCheck.value;
          const subjectClasses = Array.from(
            el.classMapGrid.querySelectorAll(`input[data-subject="${subject}"]:checked`)
          );
          if (!subjectClasses.length) {
            setStatus('signupStatus', `Please choose at least one class for ${subject}.`, 'error');
            return false;
          }
        }
      }

      if (el.fileInput && !el.fileInput.files.length) {
        setStatus('signupStatus', 'Please upload your teaching certification.', 'error');
        return false;
      }

      return true;
    }

    async function handleCreateAccount() {
      clearStatus('signupStatus');
      if (!validateTeacherSignup()) return;
      if (!window.sb || !window.sb.auth) {
        setStatus('signupStatus', 'Supabase is not ready. Please refresh the page.', 'error');
        return;
      }

      const fullName = el.fullName.value.trim();
      const workEmail = el.workEmail.value.trim();
      const phonePrefix = el.countryPrefix ? el.countryPrefix.value : '+91';
      const phone = phonePrefix + ' ' + el.phone.value.trim();
      const institutionName = el.institution.value.trim();
      const yearsOfExperience = el.experience && el.experience.value ? el.experience.value : null;
      const password = el.signupPassword.value;
      const selectedMode = document.querySelector('input[name="teachMode"]:checked')?.value || 'teachAll';
      const assignment = getTeacherAssignment();
      const staffId = generateStaffId();

      if (el.staffId) el.staffId.value = staffId;

      setLoading(el.createAccountBtn, true, 'Creating account…');

      try {
        const { data: authData, error: authError } = await window.sb.auth.signUp({
          email: workEmail,
          password,
          options: {
            data: {
              full_name: fullName,
              role: 'teacher',
            },
          },
        });
        if (authError) throw authError;

        if (!authData?.user?.id) {
          setStatus(
            'signupStatus',
            'Account created! Please check your email and confirm before signing in.',
            'success'
          );
          setLoading(el.createAccountBtn, false, 'Create Account');
          return;
        }

        const authUserId = authData.user.id;
        const teacherPayload = {
          auth_user_id: authUserId,
          full_name: fullName,
          work_email: workEmail,
          phone_country_code: phonePrefix,
          phone_number: el.phone.value.trim(),
          subject_expertise: assignment.subject_expertise,
          teaching_mode: assignment.teaching_mode,
          grade_group: assignment.grade_group,
          institution_name: institutionName,
          years_of_experience: yearsOfExperience,
          certification_url: el.fileInput && el.fileInput.files[0] ? el.fileInput.files[0].name : null,
          staff_id: staffId,
          auth_provider: 'email',
        };

        const { error: teacherError } = await window.sb.from('teachers').insert(teacherPayload);
        if (teacherError) throw teacherError;

        const { error: roleError } = await window.sb.from('user_roles').insert({
          auth_user_id: authUserId,
          role: 'teacher',
        });
        if (roleError) throw roleError;

        if (selectedMode === 'specialist') {
          const teacherRow = await window.sb
            .from('teachers')
            .select('id')
            .eq('auth_user_id', authUserId)
            .single();

          if (teacherRow?.data?.id) {
            const insertedSubjects = [];
            const subjectChecks = Array.from(
              document.querySelectorAll('#subjectChecklist input[type="checkbox"]:checked')
            );
            for (const subjectCheck of subjectChecks) {
              const subject = subjectCheck.value;
              const classValues = Array.from(
                el.classMapGrid.querySelectorAll(`input[data-subject="${subject}"]:checked`)
              ).map((input) => Number(input.value));
              if (!classValues.length) continue;
              insertedSubjects.push({
                teacher_id: teacherRow.data.id,
                subject,
                classes: classValues,
              });
            }

            if (insertedSubjects.length) {
              const { error: subjectError } = await window.sb
                .from('teacher_subjects')
                .insert(insertedSubjects);
              if (subjectError) throw subjectError;
            }
          }
        }

        localStorage.setItem(
          'teacherProfile',
          JSON.stringify({
            fullName,
            email: workEmail,
            phone,
            institutionName,
            staffId,
            authUserId,
            role: 'teacher',
          })
        );

        setStatus('signupStatus', 'Account created! Redirecting to your dashboard…', 'success');
        setTimeout(function () {
          window.location.href = 'teacher_dashboard.html';
        }, 1200);
      } catch (err) {
        console.error('[Teacher signup error]', err);
        let msg = err?.message || 'Something went wrong. Please try again.';
        if (/rate/i.test(msg)) msg = 'Too many attempts. Please wait a moment and try again.';
        if (/already registered/i.test(msg)) msg = 'This email is already registered. Try logging in instead.';
        if (/invalid email/i.test(msg)) msg = 'Please enter a valid email address.';
        if (/password/i.test(msg) && /weak/i.test(msg)) msg = 'Password is too weak. Please make it stronger.';
        setStatus('signupStatus', msg, 'error');
        setLoading(el.createAccountBtn, false, 'Create Account');
      }
    }

    if (el.createAccountBtn) {
      el.createAccountBtn.addEventListener('click', handleCreateAccount);
    }

    if (el.signupPassword) {
      el.signupPassword.addEventListener('input', function () {
        const value = this.value;
        const checks = {
          len: value.length >= 8,
          upper: /[A-Z]/.test(value),
          lower: /[a-z]/.test(value),
          special: /[^A-Za-z0-9]/.test(value),
        };
        const score = Object.values(checks).filter(Boolean).length;
        if (el.strengthBar) {
          el.strengthBar.style.width = `${score * 25}%`;
          el.strengthBar.style.background = ['', '#ef4444', '#f59e0b', '#22c55e', '#0f2c5d'][score] || '#ef4444';
        }
        if (el.pill8) el.pill8.classList.toggle('active', checks.len);
        if (el.pillUp) el.pillUp.classList.toggle('active', checks.upper);
        if (el.pillLo) el.pillLo.classList.toggle('active', checks.lower);
        if (el.pillSp) el.pillSp.classList.toggle('active', checks.special);
      });
    }

    async function handleLogin() {
      clearStatus('loginStatus');
      const email = el.loginEmail ? el.loginEmail.value.trim() : '';
      const password = el.loginPassword ? el.loginPassword.value : '';

      if (!email) {
        setStatus('loginStatus', 'Please enter your email.', 'error');
        if (el.loginEmail) el.loginEmail.focus();
        return;
      }
      if (!password) {
        setStatus('loginStatus', 'Please enter your password.', 'error');
        if (el.loginPassword) el.loginPassword.focus();
        return;
      }

      if (!window.sb || !window.sb.auth) {
        setStatus('loginStatus', 'Supabase is not ready. Please refresh the page.', 'error');
        return;
      }

      setLoading(el.loginBtn, true, 'Sign In');
      setStatus('loginStatus', 'Signing in…', 'info');

      try {
        const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const { data: roleData, error: roleError } = await window.sb
          .from('user_roles')
          .select('role')
          .eq('auth_user_id', data.user.id)
          .maybeSingle();

        if (roleError) throw roleError;
        if (!roleData || roleData.role !== 'teacher') {
          throw new Error('This account is not registered as a teacher.');
        }

        setStatus('loginStatus', 'Login successful! Redirecting…', 'success');
        setTimeout(function () {
          window.location.href = 'teacher_dashboard.html';
        }, 800);
      } catch (err) {
        console.error('[Teacher login error]', err);
        let msg = err?.message || 'Login failed. Please try again.';
        if (/invalid login credentials|invalid/i.test(msg)) msg = 'Invalid email or password.';
        setStatus('loginStatus', msg, 'error');
      } finally {
        setLoading(el.loginBtn, false, 'Sign In');
      }
    }

    if (el.loginBtn) {
      el.loginBtn.addEventListener('click', handleLogin);
    }

    if (el.loginPassword) {
      el.loginPassword.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') handleLogin();
      });
    }

    if (el.forgotBtn) {
      el.forgotBtn.addEventListener('click', async function () {
        const email = el.loginEmail ? el.loginEmail.value.trim() : '';
        if (!email) {
          setStatus('loginStatus', 'Enter your email above first.', 'error');
          if (el.loginEmail) el.loginEmail.focus();
          return;
        }

        el.forgotBtn.disabled = true;
        el.forgotBtn.textContent = 'Sending…';
        clearStatus('loginStatus');

        try {
          const { error } = await window.sb.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset_password.html',
          });
          if (error) throw error;
          setStatus('loginStatus', 'Password reset link sent! Check your inbox.', 'success');
        } catch (err) {
          setStatus('loginStatus', err?.message || 'Could not send reset link.', 'error');
        } finally {
          el.forgotBtn.disabled = false;
          el.forgotBtn.textContent = 'Forgot password?';
        }
      });
    }

    if (el.googleLoginBtn) {
      el.googleLoginBtn.addEventListener('click', async function () {
        try {
          const { error } = await window.sb.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: window.location.href.replace('teacher_login.html', 'teacher_dashboard.html'),
            },
          });
          if (error) throw error;
        } catch (err) {
          setStatus('loginStatus', err?.message || 'Google login failed.', 'error');
        }
      });
    }

    if (el.microsoftLoginBtn) {
      el.microsoftLoginBtn.addEventListener('click', async function () {
        try {
          const { error } = await window.sb.auth.signInWithOAuth({
            provider: 'azure',
            options: {
              redirectTo: window.location.href.replace('teacher_login.html', 'teacher_dashboard.html'),
            },
          });
          if (error) throw error;
        } catch (err) {
          setStatus('loginStatus', err?.message || 'Microsoft login failed.', 'error');
        }
      });
    }

    if (el.googleSignupBtn) {
      el.googleSignupBtn.addEventListener('click', async function () {
        try {
          const { error } = await window.sb.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: window.location.href.replace('teacher_login.html', 'teacher_dashboard.html'),
            },
          });
          if (error) throw error;
        } catch (err) {
          setStatus('signupStatus', err?.message || 'Google sign-up failed.', 'error');
        }
      });
    }

    if (el.microsoftSignupBtn) {
      el.microsoftSignupBtn.addEventListener('click', async function () {
        try {
          const { error } = await window.sb.auth.signInWithOAuth({
            provider: 'azure',
            options: {
              redirectTo: window.location.href.replace('teacher_login.html', 'teacher_dashboard.html'),
            },
          });
          if (error) throw error;
        } catch (err) {
          setStatus('signupStatus', err?.message || 'Microsoft sign-up failed.', 'error');
        }
      });
    }

    (async function () {
      try {
        const { data: { session } } = await window.sb.auth.getSession();
        if (!session) return;

        const { data: roleData, error } = await window.sb
          .from('user_roles')
          .select('role')
          .eq('auth_user_id', session.user.id)
          .maybeSingle();

        if (!error && roleData?.role === 'teacher') {
          window.location.href = 'teacher_dashboard.html';
        }
      } catch (_) {}
    })();

    window.sb.auth.onAuthStateChange(async function (event, session) {
      if (event !== 'SIGNED_IN' || !session?.user) return;
      const user = session.user;
      const provider = user.app_metadata?.provider || 'oauth';
      if (provider === 'email') return;

      try {
        const { data: existing } = await window.sb
          .from('teachers')
          .select('id')
          .eq('auth_user_id', user.id)
          .maybeSingle();

        if (!existing) {
          const { error: teacherError } = await window.sb.from('teachers').insert({
            auth_user_id: user.id,
            full_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
            work_email: user.email,
            phone_country_code: '+91',
            phone_number: '0000000000',
            subject_expertise: [],
            teaching_mode: 'teach_all',
            grade_group: 'grades_5_6',
            institution_name: 'To be updated',
            staff_id: generateStaffId(),
            auth_provider: provider,
          });
          if (teacherError) throw teacherError;

          const { error: roleError } = await window.sb.from('user_roles').insert({
            auth_user_id: user.id,
            role: 'teacher',
          });
          if (roleError) throw roleError;
        }

        window.location.href = 'teacher_dashboard.html';
      } catch (err) {
        console.error('[Teacher OAuth handler error]', err);
        setStatus('signupStatus', 'Sign-in succeeded but profile setup failed. Please contact support.', 'error');
      }
    });
  });
})();
