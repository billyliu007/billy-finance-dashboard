# Gemini “open app” on mobile – logic

We **do not use any custom URL scheme** for Gemini. Tapping Gemini always opens **`https://gemini.google.com/app`** in a new tab. That avoids the “Invalid URL” alert.

---

## Current behavior

**All devices (including Gemini):**

1. Copy the prompt to the clipboard.
2. Open **`https://gemini.google.com/app`** in a new tab via `window.open(href, '_blank', ...)`.

No `googleapp://robin` or other scheme is used.

---

## Why we don’t use a scheme

- **`googleapp://robin`** is for the **Google (Search) app**. If the user only has the **standalone Gemini app**, that scheme is not registered and Safari shows **“Invalid URL”**.
- The **standalone Gemini app** uses **Universal Links** for `https://gemini.google.com/app`. Opening that URL in the browser shows the page with “Open in Gemini app” at the top; the user taps that to open the app. There is no public custom scheme for the standalone app.

---

## Code location

| What | File |
|------|------|
| Gemini web URL, open action | `frontend/src/components/AiAnalysisFab.jsx` – same as other providers (copy then `window.open(href)`) |
| FAB stacking (z-index 9999, isolation) | `frontend/src/App.css` `.aiFabWrap` |
