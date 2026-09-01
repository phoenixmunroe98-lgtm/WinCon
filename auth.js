// WinCon — Milestone 16: accounts (email + password), profile details, and
// the 16+ age gate.
//
// This file is the ONLY place that talks to Supabase Auth. It runs on
// every page (loaded right after supabase-config.js) and does six jobs:
//   1. Draws the account widget in the top-right of the header — a
//      "Sign in" button when signed out, or your avatar + name + a Sign
//      out menu when signed in.
//   2. Runs sign-up — email, password, first/last name, age, and a
//      username you either type or auto-generate ({Adjective}
//      {Pokémon} — e.g. "Radiant Charizard") — and log-in, as two tabs
//      of one modal.
//   3. Assigns a starting avatar the moment an account is created: if the
//      chosen username has a Pokémon's name hiding in it, that Pokémon
//      becomes the avatar; otherwise a random one from the roster does.
//      (Milestone 18 later swaps this for "your most-used Pokémon" once
//      favourite teams exist — this is just an honest starting point.)
//   4. Runs "forgot password": email in, Supabase sends a reset link,
//      clicking it brings you back here to set a new password.
//   5. Enforces the 16+ age check: the age typed at sign-up already
//      decides `profiles.age_confirmed` server-side (see
//      supabase/migrations/0002_profile_details.sql), but the mandatory
//      modal here is the real backstop — it blocks every signed-in
//      feature for any account where that ever ends up false (an
//      incomplete sign-up, or one from before this existed).
//   6. Exposes `window.wcAuth` with a couple of small helpers
//      (`getSession()`, `getUserId()`, `getProfile()`) that later
//      milestones (cloud team storage, friends, favourite team) will
//      build on, plus `setColorTheme()` so theme.js can save a signed-in
//      user's color theme choice to their account, and fires a
//      `wc:auth-changed` window event on every session change so theme.js
//      can pick up the saved choice once a profile loads.
//
// Real name, age, and password never leave this file except in the one
// call each is handed to (`supabase.auth.signUp`) — Supabase stores and
// hashes the password; `first_name`/`last_name`/`age` land only in the
// private `profiles` table, never in the friend-visible `profile_public`
// table (see the migration's comments). None of this is required to use
// WinCon: if `window.wcSupabase` never got created (offline, or the
// Supabase CDN script is blocked), every function below quietly does
// nothing and the rest of the site works exactly as it always has,
// entirely from localStorage.

(function () {
  let wcCurrentSession = null;
  let wcCurrentProfile = null;
  let wcRecoveryMode = false; // true while handling a "reset your password" link
  let wcPokemonPool = [];     // non-Mega species names, for avatars + username generation
  let wcSpriteManifest = {};  // species name -> "sprites/xyz.png"

  const WC_DESCRIPTIVE_WORDS = [
    "Radiant", "Sleepy", "Blazing", "Shiny", "Feral", "Mighty", "Swift", "Gentle",
    "Fierce", "Plucky", "Sneaky", "Bold", "Calm", "Wild", "Lucky", "Brave",
    "Clever", "Speedy", "Cheerful", "Grumpy", "Sturdy", "Nimble", "Quiet", "Vivid",
    "Frosty", "Sunny", "Stormy", "Mystic", "Golden", "Silver", "Crimson", "Azure",
    "Emerald", "Cosmic", "Ancient", "Noble", "Loyal", "Curious", "Daring", "Jolly",
    "Zesty", "Spirited", "Rowdy", "Serene", "Rugged", "Dashing", "Witty", "Charming",
    "Restless", "Dazzling", "Humble", "Scrappy", "Vigilant", "Cunning", "Tranquil",
    "Reckless", "Steadfast", "Chipper", "Moody", "Valiant",
  ];

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

  function wcRandomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ---------------------------------------------------------------------
  // Pokémon roster (for avatars + username generation) — a small, purely
  // cosmetic fetch of the same static files the rest of the site already
  // ships, nothing to do with Supabase reachability at all.
  // ---------------------------------------------------------------------

  async function wcLoadPokemonRoster() {
    try {
      const [pokemonRes, spritesRes] = await Promise.all([fetch("data/pokemon.json"), fetch("data/sprites.json")]);
      const pokemon = await pokemonRes.json();
      wcSpriteManifest = await spritesRes.json();
      wcPokemonPool = pokemon.filter((p) => !String(p.form || "").startsWith("Mega")).map((p) => p.name);
    } catch (e) {
      console.warn("WinCon: couldn't load the Pokémon roster for avatars/usernames", e);
      wcPokemonPool = [];
      wcSpriteManifest = {};
    }
  }

  /** The first roster name (longest first, so "Alolan Ninetales" wins over any shorter overlap) that appears anywhere in `text`, or null. */
  function wcFindPokemonInText(text) {
    if (!text || wcPokemonPool.length === 0) return null;
    const lower = text.toLowerCase();
    const byLengthDesc = [...wcPokemonPool].sort((a, b) => b.length - a.length);
    for (const name of byLengthDesc) {
      if (lower.includes(name.toLowerCase())) return name;
    }
    return null;
  }

  function wcGenerateUsername() {
    if (wcPokemonPool.length === 0) return "";
    const word = wcRandomChoice(WC_DESCRIPTIVE_WORDS);
    const mon = wcRandomChoice(wcPokemonPool);
    return `${word} ${mon}`;
  }

  /** A Pokémon named inside `username` becomes the avatar; otherwise a random roster pick does. Never null as long as the roster loaded. */
  function wcResolveAvatarSpecies(username) {
    return wcFindPokemonInText(username) || (wcPokemonPool.length ? wcRandomChoice(wcPokemonPool) : null);
  }

  function wcSpritePathFor(species) {
    // sprites.json's values are relative to data/ (e.g. "sprites/charizard.png"),
    // same as every other place in this app that renders a sprite (see
    // app.js's card sprites and builder.js's spriteImg()) -- this was missing
    // that "data/" prefix, which is why avatars weren't loading.
    return species && wcSpriteManifest[species] ? `data/${wcSpriteManifest[species]}` : null;
  }

  function wcAvatarImgHTML(species, sizeClass) {
    const path = wcSpritePathFor(species);
    if (!path) return `<span class="wc-avatar-fallback ${sizeClass}" aria-hidden="true">WC</span>`;
    return `<img src="${wcEscape(path)}" alt="" class="wc-avatar-img ${sizeClass}" />`;
  }

  // ---------------------------------------------------------------------
  // Account widget (top-right of every page's header)
  // ---------------------------------------------------------------------

  function wcMountAccountWidget() {
    const slot = document.getElementById("wc-account-widget-slot");
    if (!slot || document.getElementById("wc-account-widget")) return;
    const widget = wcEl(`<div class="account-widget" id="wc-account-widget"></div>`);
    slot.appendChild(widget);
  }

  function wcDisplayNameFor(session, profile) {
    if (profile && profile.username) return profile.username;
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
    const avatarSpecies = wcCurrentProfile && wcCurrentProfile.avatar_species;
    widget.innerHTML = "";
    const wrap = wcEl(`
      <div class="account-pill-wrap">
        <button type="button" class="btn-secondary account-pill" id="wc-account-pill">
          ${wcAvatarImgHTML(avatarSpecies, "wc-avatar-pill")}
          <span class="account-pill-name">${wcEscape(name)}</span>
        </button>
        <div class="account-dropdown" id="wc-account-dropdown" hidden>
          <div class="account-dropdown-header">
            ${wcAvatarImgHTML(avatarSpecies, "wc-avatar-dropdown")}
            <div>
              <p class="account-dropdown-name">${wcEscape(name)}</p>
              <p class="account-dropdown-email">${wcEscape(email)}</p>
            </div>
          </div>
          <button type="button" class="btn-secondary" id="wc-account-info-btn">Account information</button>
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
    document.getElementById("wc-account-info-btn").addEventListener("click", () => {
      dropdown.hidden = true;
      wcOpenAccountInfoModal();
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
            <div class="wc-field-row">
              <div class="field">
                <label class="field-label" for="wc-signup-first-name">First name</label>
                <input type="text" id="wc-signup-first-name" autocomplete="given-name" />
              </div>
              <div class="field">
                <label class="field-label" for="wc-signup-last-name">Last name</label>
                <input type="text" id="wc-signup-last-name" autocomplete="family-name" />
              </div>
            </div>
            <div class="field">
              <label class="field-label" for="wc-signup-age">Age</label>
              <input type="number" id="wc-signup-age" min="1" max="120" inputmode="numeric" style="max-width: 100px;" />
            </div>
            <div class="field">
              <label class="field-label" for="wc-signup-username">Username</label>
              <div class="wc-username-row">
                <input type="text" id="wc-signup-username" autocomplete="off" maxlength="40" />
                <button type="button" class="btn-secondary" id="wc-signup-generate-username">Generate</button>
              </div>
              <p class="wc-username-status" id="wc-username-status" hidden></p>
            </div>
            <div class="wc-avatar-preview" id="wc-avatar-preview" hidden>
              <span id="wc-avatar-preview-img"></span>
              <span class="wc-avatar-preview-label">Your starting avatar: <strong id="wc-avatar-preview-name"></strong></span>
            </div>
            <div class="field">
              <label class="field-label" for="wc-signup-password">Password</label>
              <input type="password" id="wc-signup-password" autocomplete="new-password" />
            </div>
            <div class="field">
              <label class="field-label" for="wc-signup-password-confirm">Confirm password</label>
              <input type="password" id="wc-signup-password-confirm" autocomplete="new-password" />
            </div>
            <p class="wc-auth-status" id="wc-signup-status" hidden></p>
            <div class="modal-actions">
              <button type="button" class="btn-primary" id="wc-signup-submit">Create account</button>
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

    // --- Sign up: username field + live avatar preview + Generate button ---
    const signupUsername = document.getElementById("wc-signup-username");
    const usernameStatus = document.getElementById("wc-username-status");
    const avatarPreview = document.getElementById("wc-avatar-preview");
    const avatarPreviewImg = document.getElementById("wc-avatar-preview-img");
    const avatarPreviewName = document.getElementById("wc-avatar-preview-name");

    function refreshAvatarPreview() {
      const username = signupUsername.value.trim();
      if (!username || wcPokemonPool.length === 0) { avatarPreview.hidden = true; return; }
      const species = wcResolveAvatarSpecies(username);
      if (!species) { avatarPreview.hidden = true; return; }
      avatarPreview.hidden = false;
      avatarPreviewImg.innerHTML = wcAvatarImgHTML(species, "wc-avatar-preview-sprite");
      avatarPreviewName.textContent = species;
    }

    let usernameCheckToken = 0;
    async function checkUsernameAvailability() {
      const username = signupUsername.value.trim();
      if (!username) { wcSetStatus(usernameStatus, null); return; }
      const myToken = ++usernameCheckToken;
      const { data, error } = await window.wcSupabase.rpc("is_username_available", { candidate: username });
      if (myToken !== usernameCheckToken) return; // a newer check superseded this one
      if (error) { wcSetStatus(usernameStatus, null); return; }
      if (data === false) {
        wcSetStatus(usernameStatus, "That username's taken — try another or Generate one.", "error");
      } else {
        wcSetStatus(usernameStatus, "Available!", "success");
      }
    }

    signupUsername.addEventListener("input", () => {
      refreshAvatarPreview();
      checkUsernameAvailability();
    });

    document.getElementById("wc-signup-generate-username").addEventListener("click", () => {
      const generated = wcGenerateUsername();
      if (!generated) return;
      signupUsername.value = generated;
      refreshAvatarPreview();
      checkUsernameAvailability();
    });

    // --- Sign up: submit ---
    const signupEmail = document.getElementById("wc-signup-email");
    const signupFirstName = document.getElementById("wc-signup-first-name");
    const signupLastName = document.getElementById("wc-signup-last-name");
    const signupAge = document.getElementById("wc-signup-age");
    const signupPassword = document.getElementById("wc-signup-password");
    const signupPasswordConfirm = document.getElementById("wc-signup-password-confirm");
    const signupStatus = document.getElementById("wc-signup-status");
    const signupSubmit = document.getElementById("wc-signup-submit");

    signupSubmit.addEventListener("click", async () => {
      const email = (signupEmail.value || "").trim();
      const firstName = (signupFirstName.value || "").trim();
      const lastName = (signupLastName.value || "").trim();
      const ageRaw = (signupAge.value || "").trim();
      const age = ageRaw === "" ? NaN : Number(ageRaw);
      const username = (signupUsername.value || "").trim();
      const password = signupPassword.value || "";
      const confirm = signupPasswordConfirm.value || "";

      if (!wcValidEmail(email)) { wcSetStatus(signupStatus, "That doesn't look like a valid email address.", "error"); return; }
      if (!firstName) { wcSetStatus(signupStatus, "Enter your first name.", "error"); return; }
      if (!lastName) { wcSetStatus(signupStatus, "Enter your last name.", "error"); return; }
      if (!Number.isInteger(age) || age < 1 || age > 120) { wcSetStatus(signupStatus, "Enter a valid age.", "error"); return; }
      if (age < 16) { wcSetStatus(signupStatus, "You must be 16 or older to create a WinCon account.", "error"); return; }
      if (username.length < 3) { wcSetStatus(signupStatus, "Username needs to be at least 3 characters — or click Generate.", "error"); return; }
      if (password.length < 6) { wcSetStatus(signupStatus, "Password must be at least 6 characters.", "error"); return; }
      if (password !== confirm) { wcSetStatus(signupStatus, "Those passwords don't match.", "error"); return; }

      signupSubmit.disabled = true;
      wcSetStatus(signupStatus, "Checking that username…", null);
      const { data: available, error: rpcError } = await window.wcSupabase.rpc("is_username_available", { candidate: username });
      if (!rpcError && available === false) {
        signupSubmit.disabled = false;
        wcSetStatus(signupStatus, "That username's taken — try another or Generate one.", "error");
        return;
      }

      const avatarSpecies = wcResolveAvatarSpecies(username);
      wcSetStatus(signupStatus, "Creating your account…", null);
      const { data, error } = await window.wcSupabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
          data: {
            username,
            first_name: firstName,
            last_name: lastName,
            age,
            avatar_species: avatarSpecies,
          },
        },
      });
      signupSubmit.disabled = false;
      if (error) {
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
    document.getElementById("wc-signup-first-name").value = "";
    document.getElementById("wc-signup-last-name").value = "";
    document.getElementById("wc-signup-age").value = "";
    document.getElementById("wc-signup-username").value = "";
    document.getElementById("wc-signup-password").value = "";
    document.getElementById("wc-signup-password-confirm").value = "";
    document.getElementById("wc-avatar-preview").hidden = true;
    wcSetStatus(document.getElementById("wc-username-status"), null);
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
  // profiles.age_confirmed is still false for that account. A normal
  // sign-up already sets this from the age they typed (see the SQL
  // migration), so in practice this only fires for an edge case: a
  // pre-Milestone-16 account, or one whose sign-up metadata never made it
  // through.
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
  // "Account information" modal -- read-only, opened from the account
  // dropdown. Shows the things this account has on file: avatar,
  // username, real name, age, and email. First/last name and age never
  // leave this file for anywhere but this display and the one signUp
  // call that first collected them -- see supabase/migrations/
  // 0002_profile_details.sql's comments on why those stay private.
  // ---------------------------------------------------------------------

  function wcMountAccountInfoModal() {
    if (document.getElementById("wc-account-info-modal")) return;
    const modal = wcEl(`
      <div class="modal-overlay" id="wc-account-info-modal" hidden>
        <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="wc-account-info-title">
          <h3 id="wc-account-info-title">Account information</h3>
          <div class="wc-account-info-avatar-row" id="wc-account-info-avatar-row"></div>
          <dl class="wc-account-info-list" id="wc-account-info-list"></dl>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="wc-account-info-close">Close</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => { if (e.target === modal) wcCloseAccountInfoModal(); });
    document.getElementById("wc-account-info-close").addEventListener("click", wcCloseAccountInfoModal);
  }

  function wcAccountInfoRow(label, value) {
    return `<dt>${wcEscape(label)}</dt><dd>${value ? wcEscape(value) : '<span class="wc-account-info-empty">—</span>'}</dd>`;
  }

  function wcOpenAccountInfoModal() {
    const modal = document.getElementById("wc-account-info-modal");
    if (!modal || !wcCurrentSession) return;
    const p = wcCurrentProfile || {};
    const avatarRow = document.getElementById("wc-account-info-avatar-row");
    avatarRow.innerHTML = `
      ${wcAvatarImgHTML(p.avatar_species, "wc-avatar-dropdown")}
      <div>
        <p class="account-dropdown-name">${wcEscape(p.username || "")}</p>
        <p class="account-dropdown-email">${wcEscape(wcCurrentSession.user.email || "")}</p>
      </div>
    `;
    const list = document.getElementById("wc-account-info-list");
    list.innerHTML =
      wcAccountInfoRow("First name", p.first_name) +
      wcAccountInfoRow("Last name", p.last_name) +
      wcAccountInfoRow("Age", p.age != null ? String(p.age) : null) +
      wcAccountInfoRow("Starting avatar", p.avatar_species);
    modal.hidden = false;
  }

  function wcCloseAccountInfoModal() {
    const modal = document.getElementById("wc-account-info-modal");
    if (modal) modal.hidden = true;
  }

  // ---------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------

  async function wcLoadProfile(userId) {
    const { data, error } = await window.wcSupabase
      .from("profiles")
      .select("username, age_confirmed, avatar_species, first_name, last_name, age, color_theme")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.warn("WinCon: couldn't load profile", error.message);
      return null;
    }
    return data;
  }

  // Lets a signed-in user's chosen color theme (see theme.js) follow their
  // ACCOUNT rather than just this one browser's localStorage -- so it's
  // still there after they log in on a different device. It's a personal
  // UI preference, not something friends need to see, so it lives on the
  // private `profiles` table only, same privacy boundary as first_name/
  // last_name/age.
  async function wcSetColorTheme(theme) {
    if (!wcCurrentSession) return { error: new Error("Not signed in") };
    const { error } = await window.wcSupabase
      .from("profiles")
      .update({ color_theme: theme })
      .eq("id", wcCurrentSession.user.id);
    if (error) {
      console.warn("WinCon: couldn't save color theme", error.message);
    } else if (wcCurrentProfile) {
      wcCurrentProfile.color_theme = theme;
    }
    return { error };
  }

  async function wcHandleSessionChange(session) {
    wcCurrentSession = session;
    wcCurrentProfile = session ? await wcLoadProfile(session.user.id) : null;
    if (!wcRecoveryMode) wcCloseAuthModal();
    wcRenderAccountWidget();
    wcMaybeShowAgeGate();
    // Lets theme.js know a profile (with its saved color_theme, if any)
    // just became available -- fires on initial load, sign-in, sign-out,
    // and any other auth state change.
    window.dispatchEvent(new CustomEvent("wc:auth-changed", { detail: { session, profile: wcCurrentProfile } }));
  }

  async function wcInit() {
    if (!wcHasSupabase()) return;
    wcMountAccountWidget();
    wcMountAuthModal();
    wcMountNewPasswordModal();
    wcMountAgeGateModal();
    wcMountAccountInfoModal();
    // Fire and forget for the sign-up form (it just degrades gracefully
    // until this resolves) -- but if we're ALREADY signed in when this
    // finishes (the common case: this fetch races the session/profile
    // lookup below on every normal page load), the account widget was
    // just drawn with an empty sprite manifest and is stuck showing the
    // fallback "WC" circle instead of the real avatar. Redraw it once
    // the roster's in, so a slow network delays the real avatar rather
    // than losing it for the rest of the page's life.
    wcLoadPokemonRoster().then(() => {
      if (wcCurrentSession) wcRenderAccountWidget();
    });

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
    getProfile: () => wcCurrentProfile,
    setColorTheme: wcSetColorTheme,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wcInit);
  } else {
    wcInit();
  }
})();
