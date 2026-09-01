// WinCon — Milestone 15: Supabase connection.
//
// This is the ONE place the project's Supabase URL and public ("anon") key
// live. Both values are safe to ship in client-side code on purpose — the
// anon key can only do what the Row Level Security policies in
// supabase/migrations/0001_init.sql allow (a signed-out visitor can't read
// anyone's private data through it). The service_role key is a totally
// different, far more powerful secret that must NEVER appear in this file,
// in any .js file that ships to the browser, or in git at all — it only
// ever lives inside a Supabase Edge Function's server-side environment.
//
// Loaded via a <script> tag on every page, right after the Supabase CDN
// script and before teams.js/builder.js/etc., so `window.wcSupabase` is
// ready by the time the rest of the app runs. If a page doesn't include
// the CDN script (e.g. while offline, or if the CDN is unreachable),
// `window.wcSupabase` is left undefined and the rest of the app should
// keep working from localStorage alone — cloud sync is an enhancement,
// not a requirement to use WinCon.

(function () {
  const SUPABASE_URL = "https://cmxozkvlttwwnisetdid.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteG96a3ZsdHR3d25pc2V0ZGlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMjMxODksImV4cCI6MjEwMzc5OTE4OX0.9R6MC6CPwkvvwuDFm1IvtLerb8Qvw0Pq5xeE6sz4DDg";

  if (typeof window.supabase === "undefined" || !window.supabase.createClient) {
    console.warn("WinCon: Supabase library didn't load (offline, or the CDN is blocked). Cloud sync is disabled for this page load; everything still works locally.");
    return;
  }

  window.wcSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
