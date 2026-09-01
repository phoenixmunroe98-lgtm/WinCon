// WinCon — Milestone 16: accounts, sign-in, and the 16+ age gate.
//
// This file is the ONLY place that talks to Supabase Auth. It runs on
// every page (loaded right after supabase-config.js) and does four jobs:
//   1. Draws the account widget in the top-right of the header — a
//      "Sign in" button when signed out, or your name + a Sign out menu
//      when signed in.
//   2. Runs the sign-in flow: email address in, a magic link out. No
//      passwords anywhere in this app — Supabase emails a one-time link
//      that logs you in when clicked (it lands back on this same page).
//   3. Enforces the 16+ age check: the moment a session exists and this
//      account hasn't confirmed its age yet, a modal blocks everything
//      else on the page (except signing back out) until it's confirmed.
//      This mirrors `profiles.age_confirmed` in the database — the real
//      enforcement is server-side (Milestone 15's schema), this modal is
//      just the honest, unavoidable place to ask the question.
//   4. Exposes `window.wcAuth` with a couple of small helpers
//      (`getSession()`, `getUserId()`) that later milestones (cloud team
//      storage, friends, favourite team) will build on.
//
// None of this is required to use WinCon. If `window.wcSupabase` never
// got created (offline, or the Supabase CDN script is blocked), every
// function below quietly does nothing and the rest of the site works
// exactly as it always has, entirely from localStorage.

(function () {
  let wcCurrentSession = null;
  let wcCurrentProfile = null;

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
      document.getElementById("wc-signin-open-btn").addEventListener("click", wcOpenSignInModal);
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

  function wcEscape(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  // ---------------------------------------------------------------------
  // Sign-in modal (email -> magic link)
  // ---------------------------------------------------------------------

  function wcMountSignInModal() {
    if (document.getElementById("wc-signin-modal")) return;
    const modal = wcEl(`
      <div class="modal-overlay" id="wc-signin-modal" hidden>
        <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="wc-signin-title">
          <h3 id="wc-signin-title">Sign in to WinCon</h3>
          <p>Enter your email and we'll send you a one-time sign-in link — no password to create or remember. This is for saving teams to your account, friends, and update notifications; the Pokédex tracker and team builders keep working on this device without an account either way.</p>
          <div class="field">
            <label class="field-label" for="wc-signin-email">Email address</label>
            <input type="email" id="wc-signin-email" placeholder="you@example.com" autocomplete="email" />
          </div>
          <p class="wc-auth-status" id="wc-signin-status" hidden></p>
          <div class="modal-actions">
            <button type="button" class="btn-primary" id="wc-signin-send">Send me a sign-in link</button>
            <button type="button" class="btn-secondary" id="wc-signin-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(modal);

    const emailInput = document.getElementById("wc-signin-email");
    const statusEl = document.getElementById("wc-signin-status");
    const sendBtn = document.getElementById("wc-signin-send");

    document.getElementById("wc-signin-cancel").addEventListener("click", wcCloseSignInModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) wcCloseSignInModal(); });

    sendBtn.addEventListener("click", async () => {
      const email = (emailInput.value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        wcSetStatus(statusEl, "That doesn't look like a valid email address.", "error");
        return;
      }
      sendBtn.disabled = true;
      wcSetStatus(statusEl, "Sending…", null);
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await window.wcSupabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      sendBtn.disabled = false;
      if (error) {
        wcSetStatus(statusEl, `Couldn't send that: ${error.message}`, "error");
        return;
      }
      wcSetStatus(statusEl, `Check ${email} for a sign-in link. You can close this.`, "success");
    });

    emailInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendBtn.click();
    });
  }

  function wcOpenSignInModal() {
    const modal = document.getElementById("wc-signin-modal");
    if (!modal) return;
    wcSetStatus(document.getElementById("wc-signin-status"), null);
    document.getElementById("wc-signin-email").value = "";
    modal.hidden = false;
    document.getElementById("wc-signin-email").focus();
  }

  function wcCloseSignInModal() {
    const modal = document.getElementById("wc-signin-modal");
    if (modal) modal.hidden = true;
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
    const needsGate = !!wcCurrentSession && !!wcCurrentProfile && wcCurrentProfile.age_confirmed === false;
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
    wcCloseSignInModal();
    wcRenderAccountWidget();
    wcMaybeShowAgeGate();
  }

  async function wcInit() {
    if (!wcHasSupabase()) return;
    wcMountAccountWidget();
    wcMountSignInModal();
    wcMountAgeGateModal();

    const { data: { session } } = await window.wcSupabase.auth.getSession();
    await wcHandleSessionChange(session);

    window.wcSupabase.auth.onAuthStateChange((_event, session) => {
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
