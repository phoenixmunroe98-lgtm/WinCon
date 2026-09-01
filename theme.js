// WinCon — color themes: Default, Charizard, and Fairy.
//
// This is separate from light/dark mode, which stays exactly as it was
// (automatic, driven by the OS/browser's prefers-color-scheme, no manual
// override) — this is a second, independent choice layered on top:
// which character's colors and background art the site wears. Every
// color in styles.css already reads from a small set of CSS custom
// properties (--bg, --accent, etc. — see the comment at the top of that
// file), so switching a theme is just redefining those properties under
// a `[data-color-theme="..."]` selector; nothing else in the app needs
// to know a theme system exists.
//
// The tiny inline script in each page's <head> applies a saved theme's
// data-color-theme attribute before first paint (avoiding a flash of
// default colors); this file does the rest once the DOM exists: mounting
// the small theme picker in the header, and swapping `.site-bg`'s
// background art to match.

(function () {
  const WC_THEME_KEY = "wincon.colorTheme";
  const WC_VALID_THEMES = ["default", "charizard", "fairy"];

  // Each theme's background art, spread across the same 8 position slots
  // `.bg-mega-*` already styles in styles.css. "default" is the original
  // 8 fan-favorite Megas; the other two are driven entirely by this list
  // now (the HTML's own `.site-bg` div is left empty on purpose).
  const WC_THEME_BACKGROUNDS = {
    default: [
      ["mega-charizard-x", "bg-mega-tl"],
      ["mega-charizard-y", "bg-mega-tr"],
      ["mega-tyranitar", "bg-mega-bl"],
      ["mega-gengar", "bg-mega-br"],
      ["mega-greninja", "bg-mega-tc"],
      ["mega-steelix", "bg-mega-bc"],
      ["mega-raichu-x", "bg-mega-ml"],
      ["mega-raichu-y", "bg-mega-mr"],
    ],
    charizard: [
      ["charizard", "bg-mega-tl"],
      ["mega-charizard-x", "bg-mega-tr"],
      ["mega-charizard-y", "bg-mega-bl"],
      ["charizard", "bg-mega-br"],
      ["mega-charizard-x", "bg-mega-tc"],
      ["mega-charizard-y", "bg-mega-bc"],
      ["charizard", "bg-mega-ml"],
      ["mega-charizard-x", "bg-mega-mr"],
    ],
    fairy: [
      ["sylveon", "bg-mega-tl"],
      ["gardevoir", "bg-mega-tr"],
      ["clefable", "bg-mega-bl"],
      ["mimikyu", "bg-mega-br"],
      ["primarina", "bg-mega-tc"],
      ["whimsicott", "bg-mega-bc"],
      ["klefki", "bg-mega-ml"],
      ["alolan-ninetales", "bg-mega-mr"],
    ],
  };

  const WC_THEME_LABELS = {
    default: "Default",
    charizard: "🔥 Charizard",
    fairy: "✨ Fairy",
  };

  function wcGetStoredTheme() {
    try {
      const v = localStorage.getItem(WC_THEME_KEY);
      return WC_VALID_THEMES.includes(v) ? v : "default";
    } catch {
      return "default";
    }
  }

  function wcApplyThemeBackground(theme) {
    const siteBg = document.querySelector(".site-bg");
    if (!siteBg) return;
    const set = WC_THEME_BACKGROUNDS[theme] || WC_THEME_BACKGROUNDS.default;
    siteBg.innerHTML = set
      .map(([slug, cls]) => `<img src="data/sprites/${slug}.png" class="bg-mega ${cls}" alt="" />`)
      .join("");
  }

  function wcApplyTheme(theme) {
    if (theme === "default") {
      document.documentElement.removeAttribute("data-color-theme");
    } else {
      document.documentElement.setAttribute("data-color-theme", theme);
    }
    wcApplyThemeBackground(theme);
  }

  function wcSetTheme(theme) {
    try {
      localStorage.setItem(WC_THEME_KEY, theme);
    } catch {
      // no persistence available -- still apply it for this page view
    }
    wcApplyTheme(theme);
  }

  function wcMountThemeToggle() {
    const mount = document.getElementById("wc-theme-toggle-mount");
    if (!mount || document.getElementById("wc-theme-select")) return;
    const select = document.createElement("select");
    select.id = "wc-theme-select";
    select.className = "theme-toggle-select";
    select.title = "Color theme";
    select.setAttribute("aria-label", "Color theme");
    WC_VALID_THEMES.forEach((theme) => {
      const option = document.createElement("option");
      option.value = theme;
      option.textContent = WC_THEME_LABELS[theme];
      select.appendChild(option);
    });
    select.value = wcGetStoredTheme();
    select.addEventListener("change", () => wcSetTheme(select.value));
    mount.appendChild(select);
  }

  function wcInitTheme() {
    wcApplyTheme(wcGetStoredTheme());
    wcMountThemeToggle();
  }

  window.wcTheme = { get: wcGetStoredTheme, set: wcSetTheme };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wcInitTheme);
  } else {
    wcInitTheme();
  }
})();
