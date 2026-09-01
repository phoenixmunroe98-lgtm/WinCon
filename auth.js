// WinCon — Milestone 16: accounts (email + password), and the 16+ age gate.
//
// This file is the ONLY place that talks to Supabase Auth. It runs on
// every page (loaded right after supabase-config.js) and does five jobs:
//   1. Draws the account widget in the top-right of the header — a
//      "Sign in" button when signed out, or your name + a Sign out menu
//      when signed in.
//   2. Runs sign-up (email + password + a required 16+ checkbox) and
//      log-in (email + password) as two tabs of one modal.
//   3. Runs "forgot password": email in, Supabase sends a reset link,
//      clicking it brings you back here to set a new password.
//   4. Enforces the 16+ age check: the moment a session exists and this
//      account hasn't confirmed its age yet, a modal blocks everything
//      else on the page (except signing back out) until it's confirmed.
//      This is the real, database-enforced gate — the checkbox at sign-up
//      is a courtesy, this modal is what actually sets
//      `profiles.age_confirmed`, so it also catches an account created
//      before this existed, or a sign-up that never got a session (e.g.
//      email confirmation was required) until they actually log in.
//   5. Exposes `window.wcAuth` with a couple of small helpers
//      (`getSession()`, `getUserId()`) that later milestones (cloud team
//      storage, friends, favourite team) will build on.
//
// Supabase's own Auth handles passwords entirely — they're hashed and
// stored on Supabase's servers, never touched by any code in this file
// beyond the one moment of typing them into the sign-up/log-in form and
// handing them straight to `supabase.auth.signUp` / `signInWithPassword`.
//
// None of this is required to use WinCon. If `window.wcSupabase` never
// got created (offline, or the Supabase CDN script is blocked), every
// function below quietly does nothing and the rest of the site works
// exactly as it always has, entirely from localStorage.

(function () {
  let wcCurrentSession = null;
  let wcCurrentProfile = null;
  let wcRecoveryMode = false; // true while handling a "reset your password" link

  function wcHasSupabase() {
    return typeof window.wcSupabase !== "undefined" && window.wcSupabase;
  }

  // ---------------------------------------------------------------------
  // Small DOM helpers
  // ---------------------------------------------------------------------

  function wcEl(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function wcSetStatus(el, message, kind) {
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.className = "wc-auth-status" + (kind ? ` is-${kind}` : "");
  }

  function wcEscape(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function wcValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // ---------------------------------------------------------------------
  // Account widget (top-right of every page's header)
  // ---------------------------------------------------------------------

  function wcMountAccountWidget() {
    const nav = document.querySelector(".topbar-row");
    if (!nav || document.getElementById("wc-account-widget")) return;
    const widget = wcEl(`<div class="account-widget" id="wc-account-widget"></div>`);
    nav.appendChild(widget);
  }

  function wcDisplayNameFor(session, profile) {
    if (profile && profile.display_name && profile.display_name !== "New Trainer") return profile.display_name;
    if (session && session.user && session.user.email) return session.user.email.split("@")[0];
    return "Trainer";
  }

  function wcRenderAccountWidget() {
    const widget = document.getElementById("wc-account-widget");
    if (!widget) return;

    if (!wcCurrentSession) {
      widget.innerHTML = "";
      widget.appendChild(wcEl(`<button type="button" class="btn-secondary" id="wc-signin-open-btn">Sign in</button>`));
      document.getElementById("wc-signin-open-btn").addEventListener("click", () => wcOpenAuthModal("login"));
      return;
    }

    const name = wcDisplayNameFor(wcCurrentSession, wcCurrentProfile);
    const email = wcCurrentSession.user.email || "";
    widget.innerHTML = "";
    const wrap = wcEl(`
      <div class="account-pill-wrap">
        <button type="button" class="btn-secondary account-pill" id="wc-account-pill">${wcEscape(name)}</button>
        <div class="account-dropdown" id="wc-account-dropdown" hidden>
          <p class="account-dropdown-email">${wcEscape(email)}</p>
          <button type="button" class="btn-secondary btn-danger" id="wc-signout-btn">Sign out</button>
        </div>
      </div>
    `);
    widget.appendChild(wrap);

    const pill = document.getElementById("wc-account-pill");
    const dropdown = document.getElementById("wc-account-dropdown");
    pill.addEventListener("click", () => { dropdown.hidden = !dropdown.hidden; });
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) dropdown.hidden = true;
    });
    document.getElementById("wc-signout-btn").addEventListener("click", async () => {
      dropdown.hidden = true;
      await window.wcSupabase.auth.signOut();
    });
  }

  // ---------------------------------------------------------------------
  // Sign-in / sign-up / forgot-password modal (one modal, three modes)
  // ---------------------------------------------------------------------

  function wcMountAuthModal() {
    if (document.getElementById("wc-auth-modal")) return;
    const modal = wcEl(`
      <div class="modal-overlay" id="wc-auth-modal" hidden>
        <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="wc-auth-title">
          <div class="wc-auth-tabs" id="wc-auth-tabs">
            <button type="button" class="wc-auth-tab is-active" id="wc-auth-tab-login" data-mode="login">Log In</button>
            <button type="button" class="wc-auth-tab" id="wc-auth-tab-signup" data-mode="signup">Sign Up</button>
          </div>
          <h3 id="wc-auth-title">Log in to WinCon</h3>

          <div id="wc-login-form">
            <div class="field">
              <label class="field-label" for="wc-login-email">Email address</label>
              <input type="email" id="wc-login-email" autocomplete="email" />
            </div>
            <div class="field">
              <label class="field-label" for="wc-login-password">Password</label>
              <input type="password" id="wc-login-password" autocomplete="current-password" />
            </div>
            <button type="button" class="wc-link-btn" id="wc-forgot-open-btn">Forgot your password?</button>
            <p class="wc-auth-status" id="wc-login-status" hidden></p>
            <div class="modal-actions">
              <button type="button" class="btn-primary" id="wc-login-submit">Log In</button>
              <button type="button" class="btn-secondary" id="wc-login-cancel">Cancel</button>
            </div>
          </div>

          <div id="wc-signup-form" hidden>
            <div class="field">
              <label class="field-label" for="wc-signup-email">Email address</label>
              <input type="email" id="wc-signup-email" autocomplete="email" />
            </div>
            <div class="field">
              <label class="field-label" for="wc-signup-password">Password</label>
              <input type="password" id="wc-signup-password" autocomplete="new-password" />
            </div>
            <div class="field">
              <label class="field-label" for="wc-signup-password-confirm">Confirm password</label>
              <input type="password" id="wc-signup-password-confirm" autocomplete="new-password" />
            </div>
            <label class="wc-agegate-check">
              <input type="checkbox" id="wc-signup-age-checkbox" />
              I confirm that I am 16 years of age or older.
            </label>
            <p class="wc-auth-status" id="wc-signup-status" hidden></p>
            <div class="modal-actions">
              <button type="button" class="btn-primary" id="wc-signup-submit" disabled>Create account</button>
              <button type="button" class="btn-secondary" id="wc-signup-cancel">Cancel</button>
            </div>
          </div>

          <div id="wc-forgot-form" hidden>
            <p>Enter your account's email address and we'll send you a link to set a new password.</p>
            <div class="field">
              <label class="field-label" for="wc-forgot-email">Email address</label>
              <input type="email" id="wc-forgot-email" autocomplete="email" />
            </div>
            <p class="wc-auth-status" id="wc-forgot-status" hidden></p>
            <div class="modal-actions">
              <button type="button" class="btn-primary" id="wc-forgot-submit">Send reset link</button>
              <button type="button" class="wc-link-btn" id="wc-forgot-back-btn">Back to log in</button>
            </div>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(modal);

    modal.addEventListener("click", (e) => { if (e.target === modal) wcCloseAuthModal(); });
    document.getElementById("wc-auth-tab-login").addEventListener("click", () => wcSetAuthMode("login"));
    document.getElementById("wc-auth-tab-signup").addEventListener("click", () => wcSetAuthMode("signup"));
    document.getElementById("wc-forgot-open-btn").addEventListener("click", () => wcSetAuthMode("forgot"));
    document.getElementById("wc-forgot-back-btn").addEventListener("click", () => wcSetAuthMode("login"));
    document.getElementById("wc-login-cancel").addEventListener("click", wcCloseAuthModal);
    document.getElementById("wc-signup-cancel").addEventListener("click", wcCloseAuthModal);

    // --- Log in ---
    const loginEmail = document.getElementById("wc-login-email");
    const loginPassword = document.getElementById("wc-login-password");
    const loginStatus = document.getElementById("wc-login-status");
    const loginSubmit = document.getElementById("wc-login-submit");

    async function submitLogin() {
      const email = (loginEmail.value || "").trim();
      const password = loginPassword.value || "";
      if (!wcValidEmail(email)) { wcSetStatus(loginStatus, "That doesn't look like a valid email address.", "error"); return; }
      if (!password) { wcSetStatus(loginStatus, "Enter your password.", "error"); return; }
      loginSubmit.disabled = true;
      wcSetStatus(loginStatus, "Logging in…", null);
      const { error } = await window.wcSupabase.auth.signInWithPassword({ email, password });
      loginSubmit.disabled = false;
      if (error) {
        wcSetStatus(loginStatus, `Couldn't log in: ${error.message}`, "error");
        return;
      }
      // onAuthStateChange closes the modal once the session lands.
    }
    loginSubmit.addEventListener("click", submitLogin);
    loginPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") submitLogin(); });

    // --- Sign up ---
    const signupEmail = document.getElementById("wc-signup-email");
    const signupPassword = document.getElementById("wc-signup-password");
    const signupPasswordConfirm = document.getElementById("wc-signup-password-confirm");
    const signupAgeCheckbox = document.getElementById("wc-signup-age-checkbox");
    const signupStatus = document.getElementById("wc-signup-status");
    const signupSubmit = document.getElementById("wc-signup-submit");

    signupAgeCheckbox.addEventListener("change", () => { signupSubmit.disabled = !signupAgeCheckbox.checked; });

    signupSubmit.addEventListener("click", async () => {
      const email = (signupEmail.value || "").trim();
      const password = signupPassword.value || "";
      const confirm = signupPasswordConfirm.value || "";
      if (!wcValidEmail(email)) { wcSetStatus(signupStatus, "That doesn't look like a valid email address.", "error"); return; }
      if (password.length < 6) { wcSetStatus(signupStatus, "Password must be at least 6 characters.", "error"); return; }
      if (password !== confirm) { wcSetStatus(signupStatus, "Those passwords don't match.", "error"); return; }
      if (!signupAgeCheckbox.checked) { wcSetStatus(signupStatus, "You need to confirm you're 16 or older to create an account.", "error"); return; }

      signupSubmit.disabled = true;
      wcSetStatus(signupStatus, "Creating your account…", null);
      const { data, error } = await window.wcSupabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      });
      signupSubmit.disabled = false;
      if (error) {
        signupSubmit.disabled = !signupAgeCheckbox.checked;
        wcSetStatus(signupStatus, `Couldn't create that account: ${error.message}`, "error");
        return;
      }
      if (data && data.session) {
        // Email confirmation is off for this project — already signed in.
        return; // onAuthStateChange takes it from here.
      }
      wcSetStatus(signupStatus, `Almost there — check ${email} for a confirmation link, then log in.`, "success");
    });

    // --- Forgot password ---
    const forgotEmail = document.getElementById("wc-forgot-email");
    const forgotStatus = document.getElementById("wc-forgot-status");
    const forgotSubmit = document.getElementById("wc-forgot-submit");

    forgotSubmit.addEventListener("click", async () => {
      const email = (forgotEmail.value || "").trim();
      if (!wcValidEmail(email)) { wcSetStatus(forgotStatus, "That doesn't look like a valid email address.", "error"); return; }
      forgotSubmit.disabled = true;
      wcSetStatus(forgotStatus, "Sending…", null);
      const { error } = await window.wcSupabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      forgotSubmit.disabled = false;
      if (error) {
        wcSetStatus(forgotStatus, `Couldn't send that: ${error.message}`, "error");
        return;
      }
      wcSetStatus(forgotStatus, `Check ${email} for a link to set a new password.`, "success");
    });
  }

  function wcSetAuthMode(mode) {
    const tabs = document.getElementById("wc-auth-tabs");
    const title = document.getElementById("wc-auth-title");
    const forms = {
      login: document.getElementById("wc-login-form"),
      signup: document.getElementById("wc-signup-form"),
      forgot: document.getElementById("wc-forgot-form"),
    };
    Object.entries(forms).forEach(([key, el]) => { el.hidden = key !== mode; });
    tabs.hidden = mode === "forgot";
    document.getElementById("wc-auth-tab-login").classList.toggle("is-active", mode === "login");
    document.getElementById("wc-auth-tab-signup").classList.toggle("is-active", mode === "signup");
    title.textContent = mode === "login" ? "Log in to WinCon" : mode === "signup" ? "Create your WinCon account" : "Reset your password";

    wcSetStatus(document.getElementById("wc-login-status"), null);
    wcSetStatus(document.getElementById("wc-signup-status"), null);
    wcSetStatus(document.getElementById("wc-forgot-status"), null);

    const focusTarget = mode === "login" ? "wc-login-email" : mode === "signup" ? "wc-signup-email" : "wc-forgot-email";
    const el = document.getElementById(focusTarget);
    if (el) el.focus();
  }

  function wcOpenAuthModal(mode) {
    const modal = document.getElementById("wc-auth-modal");
    if (!modal) return;
    document.getElementById("wc-login-email").value = "";
    document.getElementById("wc-login-password").value = "";
    document.getElementById("wc-signup-email").value = "";
    document.getElementById("wc-signup-password").value = "";
    document.getElementById("wc-signup-password-confirm").value = "";
    document.getElementById("wc-signup-age-checkbox").checked = false;
    document.getElementById("wc-signup-submit").disabled = true;
    document.getElementById("wc-forgot-email").value = "";
    modal.hidden = false;
    wcSetAuthMode(mode || "login");
  }

  function wcCloseAuthModal() {
    const modal = document.getElementById("wc-auth-modal");
    if (modal) modal.hidden = true;
  }

  // ---------------------------------------------------------------------
  // "Set a new password" modal — shown after clicking a password-reset
  // email link (Supabase fires a PASSWORD_RECOVERY auth event for this).
  // ---------------------------------------------------------------------

  function wcMountNewPasswordModal() {
    if (document.getElementById("wc-newpassword-modal")) return;
    const modal = wcEl(`
      <div class="modal-overlay" id="wc-newpassword-modal" hidden>
        <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="wc-newpw-title">
          <h3 id="wc-newpw-title">Set a new password</h3>
          <p>Choose a new password for your WinCon account.</p>
          <div class="field">
            <label class="field-label" for="wc-newpw-1">New password</label>
            <input type="password" id="wc-newpw-1" autocomplete="new-password" />
          </div>
          <div class="field">
            <label class="field-label" for="wc-newpw-2">Confirm new password</label>
            <input type="password" id="wc-newpw-2" autocomplete="new-password" />
          </div>
          <p class="wc-auth-status" id="wc-newpw-status" hidden></p>
          <div class="modal-actions">
            <button type="button" class="btn-primary" id="wc-newpw-submit">Set new password</button>
            <button type="button" class="btn-secondary" id="wc-newpw-cancel">Cancel and sign out</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(modal);

    const pw1 = document.getElementById("wc-newpw-1");
    const pw2 = document.getElementById("wc-newpw-2");
    const status = document.getElementById("wc-newpw-status");
    const submit = document.getElementById("wc-newpw-submit");

    submit.addEventListener("click", async () => {
      if (pw1.value.length < 6) { wcSetStatus(status, "Password must be at least 6 characters.", "error"); return; }
      if (pw1.value !== pw2.value) { wcSetStatus(status, "Those passwords don't match.", "error"); return; }
      submit.disabled = true;
      wcSetStatus(status, "Saving…", null);
      const { error } = await window.wcSupabase.auth.updateUser({ password: pw1.value });
      submit.disabled = false;
      if (error) {
        wcSetStatus(status, `Couldn't set that password: ${error.message}`, "error");
        return;
      }
      wcRecoveryMode = false;
      modal.hidden = true;
      wcMaybeShowAgeGate();
    });

    document.getElementById("wc-newpw-cancel").addEventListener("click", async () => {
      wcRecoveryMode = false;
      modal.hidden = true;
      await window.wcSupabase.auth.signOut();
    });
  }

  function wcOpenNewPasswordModal() {
    const modal = document.getElementById("wc-newpassword-modal");
    if (!modal) return;
    document.getElementById("wc-newpw-1").value = "";
    document.getElementById("wc-newpw-2").value = "";
    wcSetStatus(document.getElementById("wc-newpw-status"), null);
    modal.hidden = false;
  }

  // ---------------------------------------------------------------------
  // Mandatory age-gate modal — shown whenever a session exists but
  // profiles.age_confirmed is still false for that account.
  // ---------------------------------------------------------------------

  function wcMountAgeGateModal() {
    if (document.getElementById("wc-agegate-modal")) return;
    const modal = wcEl(`
      <div class="modal-overlay" id="wc-agegate-modal" hidden>
        <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="wc-agegate-title">
          <h3 id="wc-agegate-title">Confirm your age</h3>
          <p>WinCon accounts — cloud-saved teams, friends, and update notifications — are for trainers age 16 and up. You can keep using the Pokédex tracker and team builders on this device without an account regardless of age; this check only applies to signed-in features.</p>
          <label class="wc-agegate-check">
            <input type="checkbox" id="wc-agegate-checkbox" />
            I confirm that I am 16 years of age or older.
          </label>
          <p class="wc-auth-status" id="wc-agegate-status" hidden></p>
          <div class="modal-actions">
            <button type="button" class="btn-primary" id="wc-agegate-confirm" disabled>Continue</button>
            <button type="button" class="btn-secondary" id="wc-agegate-signout">Sign out instead</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(modal);

    const checkbox = document.getElementById("wc-agegate-checkbox");
    const confirmBtn = document.getElementById("wc-agegate-confirm");
    const statusEl = document.getElementById("wc-agegate-status");

    checkbox.addEventListener("change", () => { confirmBtn.disabled = !checkbox.checked; });

    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      wcSetStatus(statusEl, "Saving…", null);
      const { error } = await window.wcSupabase
        .from("profiles")
        .update({ age_confirmed: true, age_confirmed_at: new Date().toISOString() })
        .eq("id", wcCurrentSession.user.id);
      if (error) {
        wcSetStatus(statusEl, `Something went wrong: ${error.message}`, "error");
        confirmBtn.disabled = false;
        return;
      }
      wcCurrentProfile = wcCurrentProfile || {};
      wcCurrentProfile.age_confirmed = true;
      document.getElementById("wc-agegate-modal").hidden = true;
      wcRenderAccountWidget();
    });

    document.getElementById("wc-agegate-signout").addEventListener("click", async () => {
      await window.wcSupabase.auth.signOut();
    });
  }

  function wcMaybeShowAgeGate() {
    const modal = document.getElementById("wc-agegate-modal");
    if (!modal) return;
    const needsGate = !wcRecoveryMode && !!wcCurrentSession && !!wcCurrentProfile && wcCurrentProfile.age_confirmed === false;
    modal.hidden = !needsGate;
    if (needsGate) {
      document.getElementById("wc-agegate-checkbox").checked = false;
      document.getElementById("wc-agegate-confirm").disabled = true;
      wcSetStatus(document.getElementById("wc-agegate-status"), null);
    }
  }

  // ---------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------

  async function wcLoadProfile(userId) {
    const { data, error } = await window.wcSupabase
      .from("profiles")
      .select("display_name, age_confirmed")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.warn("WinCon: couldn't load profile", error.message);
      return null;
    }
    return data;
  }

  async function wcHandleSessionChange(session) {
    wcCurrentSession = session;
    wcCurrentProfile = session ? await wcLoadProfile(session.user.id) : null;
    if (!wcRecoveryMode) wcCloseAuthModal();
    wcRenderAccountWidget();
    wcMaybeShowAgeGate();
  }

  async function wcInit() {
    if (!wcHasSupabase()) return;
    wcMountAccountWidget();
    wcMountAuthModal();
    wcMountNewPasswordModal();
    wcMountAgeGateModal();

    const { data: { session } } = await window.wcSupabase.auth.getSession();
    await wcHandleSessionChange(session);

    window.wcSupabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        wcRecoveryMode = true;
        wcOpenNewPasswordModal();
      }
      wcHandleSessionChange(session);
    });
  }

  window.wcAuth = {
    getSession: () => wcCurrentSession,
    getUserId: () => (wcCurrentSession ? wcCurrentSession.user.id : null),
    isSignedIn: () => !!wcCurrentSession,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wcInit);
  } else {
    wcInit();
  }
})();
