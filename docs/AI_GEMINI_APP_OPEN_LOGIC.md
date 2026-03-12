# Gemini “open app” on mobile – logic

On **mobile only**, we try the app scheme first, then fall back to the Universal Link. On desktop we open the web URL only.

---

## Current behavior

**Mobile (Gemini):**

1. Copy the prompt to the clipboard.
2. Try **`googleapp://robin`** via `window.location.href = appUrl` (opens Gemini in the **Google app** if installed).
3. Start a **1.5 s** fallback timer. If `document.visibilityState === 'hidden'`, cancel (app opened).
4. If the timer fires, open **`https://gemini.google.com/app`** in a new tab (Universal Link; standalone Gemini app may show “Open in app” at top).

**Desktop / other providers:** Copy then `window.open(href, '_blank', ...)`.

---

## Why it can’t always go “direct” to the app

- **Google app:** `googleapp://robin` goes straight to the Gemini tab. If that scheme isn’t registered (e.g. user only has the **standalone Gemini app**), Safari may show “Invalid URL”; after 1.5 s we open the web URL.
- **Standalone Gemini app:** It mainly uses **Universal Links** (`https://gemini.google.com/app`). The OS often opens that URL in the **browser first**; the page then shows “Open in Gemini app” at the top. There is no well‑documented custom scheme for the standalone app, so we can’t jump straight into it from the web without that banner step.

---

## Code location

| What | File |
|------|------|
| Mobile check, `openGeminiWithAppFallback` | `frontend/src/components/AiAnalysisFab.jsx` |
| Scheme: `googleapp://robin`; fallback 1500 ms; then `window.open(webUrl)` | same |
| FAB stacking (z-index 9999, isolation, pointer-events) | `frontend/src/App.css` `.aiFabWrap` |
