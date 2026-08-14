(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const el = {
      fullName: document.getElementById('fullName'),
      classGrade: document.getElementById('classGrade'),
      streamField: document.getElementById('streamField'),
      stream: document.getElementById('stream'),
      dob: document.getElementById('dob'),
      email: document.getElementById('email'),
      countryCode: document.getElementById('countryCode'),
      phone: document.getElementById('phone'),
      password: document.getElementById('password'),
      togglePw: document.getElementById('togglePassword'),
      strengthBar: document.getElementById('strengthBar'),
      pill8: document.getElementById('pill8'),
      pillUp: document.getElementById('pillUpper'),
      pillLo: document.getElementById('pillLower'),
      pillSp: document.getElementById('pillSpecial'),
      forgotBtn: document.getElementById('forgotBtn'),
      googleBtn: document.getElementById('googleBtn'),
      msBtn: document.getElementById('microsoftBtn'),
      agreeTerms: document.getElementById('agreeTerms'),
      submitBtn: document.getElementById('createAccountBtn'),
      statusMsg: document.getElementById('statusMsg'),
      themeBtn: document.getElementById('themeBtn'),
    };

    function getTheme() {
      return localStorage.getItem('sl-theme') || 'dark';
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

    if (el.classGrade && el.streamField) {
      el.classGrade.addEventListener('change', function () {
        const grade = el.classGrade.value;
        const show = grade === '11' || grade === '12';
        el.streamField.classList.toggle('visible', show);
        if (!show && el.stream) el.stream.value = '';
      });
    }

    if (el.togglePw && el.password) {
      el.togglePw.addEventListener('click', function () {
        const hidden = el.password.type === 'password';
        el.password.type = hidden ? 'text' : 'password';
        this.textContent = hidden ? 'Hide' : 'Show';
      });
    }

    const STRENGTH_COLORS = ['', '#f85149', '#f59e0b', '#3fb950', '#4f8ef7'];

    if (el.password) {
      el.password.addEventListener('input', function () {
        const value = el.password.value;
        const checks = {
          len: value.length >= 8,
          up: /[A-Z]/.test(value),
          lo: /[a-z]/.test(value),
          sp: /[^A-Za-z0-9]/.test(value),
        };
        const score = Object.values(checks).filter(Boolean).length;

        if (el.strengthBar) {
          el.strengthBar.style.width = `${score * 25}%`;
          el.strengthBar.style.background = STRENGTH_COLORS[score] || '#f85149';
        }

        if (el.pill8) el.pill8.classList.toggle('active', checks.len);
        if (el.pillUp) el.pillUp.classList.toggle('active', checks.up);
        if (el.pillLo) el.pillLo.classList.toggle('active', checks.lo);
        if (el.pillSp) el.pillSp.classList.toggle('active', checks.sp);
      });
    }

    function setStatus(msg, type) {
      if (!el.statusMsg) return;
      el.statusMsg.textContent = msg;
      el.statusMsg.className = 'status-msg ' + (type || 'info');
    }

    function clearStatus() {
      setStatus('', 'info');
    }

    function setLoading(on) {
      if (!el.submitBtn) return;
      if (on) {
        el.submitBtn.dataset.orig = el.submitBtn.innerHTML;
        el.submitBtn.innerHTML = '<span class="spinner"></span>Creating account…';
        el.submitBtn.disabled = true;
      } else {
        el.submitBtn.innerHTML = el.submitBtn.dataset.orig || 'Create Account';
        el.submitBtn.disabled = false;
      }
    }

    function validate() {
      const grade = el.classGrade ? el.classGrade.value : '';
      const stream = el.stream ? el.stream.value : '';
      const password = el.password ? el.password.value : '';
      const email = el.email ? el.email.value.trim() : '';
      const phone = el.phone ? el.phone.value.trim() : '';
      const fullName = el.fullName ? el.fullName.value.trim() : '';
      const dob = el.dob ? el.dob.value : '';
      const agreed = el.agreeTerms ? el.agreeTerms.checked : false;

      if (!fullName) {
        setStatus('Please enter your full name.', 'error');
        if (el.fullName) el.fullName.focus();
        return false;
      }
      if (!grade) {
        setStatus('Please select your class / grade.', 'error');
        if (el.classGrade) el.classGrade.focus();
        return false;
      }
      if ((grade === '11' || grade === '12') && !stream) {
        setStatus('Please select your stream for Grade 11/12.', 'error');
        if (el.stream) el.stream.focus();
        return false;
      }
      if (!dob) {
        setStatus('Please enter your date of birth.', 'error');
        if (el.dob) el.dob.focus();
        return false;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) {
        setStatus('Please enter a valid email address.', 'error');
        if (el.email) el.email.focus();
        return false;
      }
      if (!phone || phone.replace(/\D/g, '').length < 7) {
        setStatus('Please enter a valid phone number.', 'error');
        if (el.phone) el.phone.focus();
        return false;
      }
      if (
        password.length < 8 ||
        !/[A-Z]/.test(password) ||
        !/[a-z]/.test(password) ||
        !/[^A-Za-z0-9]/.test(password)
      ) {
        setStatus(
          'Password needs 8+ chars, uppercase, lowercase, and a special character.',
          'error'
        );
        if (el.password) el.password.focus();
        return false;
      }
      if (!agreed) {
        setStatus('Please agree to the Terms of Service to continue.', 'error');
        return false;
      }
      return true;
    }

    async function handleCreateAccount() {
      clearStatus();
      if (!validate()) return;
      if (!window.sb || !window.sb.auth) {
        setStatus('Supabase is not ready. Please refresh the page.', 'error');
        return;
      }

      const fullName = el.fullName.value.trim();
      const grade = el.classGrade.value;
      const stream = el.stream ? el.stream.value || null : null;
      const dob = el.dob.value;
      const email = el.email.value.trim();
      const prefix = el.countryCode ? el.countryCode.value : '+91';
      const phone = prefix + ' ' + el.phone.value.trim();
      const password = el.password.value;

      setLoading(true);

      try {
        const { data: authData, error: authError } = await window.sb.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              class_grade: grade,
              role: 'learner',
            },
          },
        });

        if (authError) throw authError;

        if (!authData?.user?.id) {
          setStatus(
            'Account created! Please check your email and click the confirmation link before signing in.',
            'success'
          );
          setLoading(false);
          return;
        }

        const userId = authData.user.id;

        const { error: learnerError } = await window.sb.from('learners').insert({
          auth_user_id: userId,
          full_name: fullName,
          class_grade: grade,
          date_of_birth: dob,
          email: email,
          phone_number: phone,
          agreed_to_terms: true,
          auth_provider: 'email',
          stream: stream,
        });

        if (learnerError) throw learnerError;

        const { error: roleError } = await window.sb.from('user_roles').insert({
          auth_user_id: userId,
          role: 'learner',
        });

        if (roleError) throw roleError;

        setStatus('Account created! Redirecting to your dashboard…', 'success');
        setTimeout(function () {
          window.location.href = 'learner_dashboard.html';
        }, 1200);
      } catch (err) {
        console.error('[Learner signup error]', err);
        let msg = err?.message || 'Something went wrong. Please try again.';
        if (/rate/i.test(msg)) msg = 'Too many attempts. Please wait a moment and try again.';
        if (/already registered/i.test(msg)) msg = 'This email is already registered. Try logging in instead.';
        if (/invalid email/i.test(msg)) msg = 'Please enter a valid email address.';
        if (/password/i.test(msg) && /weak/i.test(msg)) msg = 'Password is too weak. Please make it stronger.';
        setStatus(msg, 'error');
        setLoading(false);
      }
    }

    if (el.submitBtn) {
      el.submitBtn.addEventListener('click', handleCreateAccount);
    }

    document
      .querySelectorAll(
        'input[type="text"], input[type="email"], input[type="password"], input[type="tel"], input[type="date"]'
      )
      .forEach(function (input) {
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') handleCreateAccount();
        });
      });

    if (el.forgotBtn) {
      el.forgotBtn.addEventListener('click', async function () {
        const email = el.email ? el.email.value.trim() : '';

        if (!email) {
          setStatus('Enter your email address above first, then click Forgot password.', 'error');
          if (el.email) el.email.focus();
          return;
        }

        el.forgotBtn.disabled = true;
        el.forgotBtn.textContent = 'Sending…';
        clearStatus();

        try {
          const { error } = await window.sb.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html',
          });
          if (error) throw error;
          setStatus('Password reset link sent! Check your inbox.', 'success');
        } catch (err) {
          setStatus(err?.message || 'Could not send reset link. Please try again.', 'error');
        } finally {
          el.forgotBtn.disabled = false;
          el.forgotBtn.textContent = 'Forgot password?';
        }
      });
    }

    if (el.googleBtn) {
      el.googleBtn.addEventListener('click', async function () {
        try {
          const { error } = await window.sb.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: window.location.href.replace('learner_login.html', 'learner_dashboard.html'),
              queryParams: {
                access_type: 'offline',
                prompt: 'consent',
              },
            },
          });
          if (error) throw error;
        } catch (err) {
          setStatus(err?.message || 'Google sign-in failed. Please try again.', 'error');
        }
      });
    }

    if (el.msBtn) {
      el.msBtn.addEventListener('click', async function () {
        try {
          const { error } = await window.sb.auth.signInWithOAuth({
            provider: 'azure',
            options: {
              redirectTo: window.location.href.replace('learner_login.html', 'learner_dashboard.html'),
              scopes: 'email profile',
            },
          });
          if (error) throw error;
        } catch (err) {
          setStatus(err?.message || 'Microsoft sign-in failed. Please try again.', 'error');
        }
      });
    }

    (async function () {
      try {
        const {
          data: { user },
        } = await window.sb.auth.getUser();
        if (user) {
          window.location.href = 'learner_dashboard.html';
          return;
        }
      } catch (_) {}

      const overlay = document.getElementById('pageOverlay');
      if (overlay) {
        overlay.classList.add('hide');
        setTimeout(function () {
          if (overlay.parentNode) overlay.remove();
        }, 350);
      }
    })();

    window.sb.auth.onAuthStateChange(async function (event, session) {
      if (event !== 'SIGNED_IN' || !session?.user) return;

      const user = session.user;
      const provider = user.app_metadata?.provider || 'oauth';

      if (provider === 'email') return;

      try {
        const { data: existing } = await window.sb
          .from('learners')
          .select('id')
          .eq('auth_user_id', user.id)
          .maybeSingle();

        if (!existing) {
          const { error: learnerErr } = await window.sb.from('learners').insert({
            auth_user_id: user.id,
            full_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
            email: user.email,
            auth_provider: provider,
            agreed_to_terms: true,
          });
          if (learnerErr) throw learnerErr;

          const { error: roleErr } = await window.sb.from('user_roles').insert({
            auth_user_id: user.id,
            role: 'learner',
          });
          if (roleErr) throw roleErr;
        }

        window.location.href = 'learner_dashboard.html';
      } catch (err) {
        console.error('[OAuth handler error]', err);
        setStatus('Sign-in succeeded but profile setup failed. Please contact support.', 'error');
        const overlay = document.getElementById('pageOverlay');
        if (overlay) overlay.classList.add('hide');
      }
    });
  });
})();
