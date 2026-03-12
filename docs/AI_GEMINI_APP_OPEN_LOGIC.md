# Gemini “open app” on mobile – logic (Universal Link priority)

We use **Option 2: Prioritize the Universal Link** so the OS can open the Gemini app via Universal Links (iOS) / App Links (Android) and we avoid the "Invalid URL" alert from custom schemes.

---

## Current behavior

When the user taps **Gemini** in the AI analysis modal (any device):

1. **Copy** the prompt to the clipboard.
2. **Open** `https://gemini.google.com/app` in a new tab via `window.open(href, '_blank', 'noopener,noreferrer')`.

No custom URI scheme is used. The same flow runs on desktop and mobile.

---

## Why this approach

- **Universal Link (HTTPS)** is the recommended way for the standalone Gemini app on iOS. Custom schemes like `googleapp://robin` are tied to the **Google (Search) app**; if the user has only the **standalone Gemini app**, that scheme is not registered and Safari shows "Invalid URL."
- Letting the OS handle `https://gemini.google.com/app` means:
  - If the Gemini app is installed and claims that URL, the system can open the app or show "Open in App."
  - If not, the URL opens in the browser. No system alert, no fallback timer.

---

## Code location

| What | File | Notes |
|------|------|--------|
| Gemini web URL | `frontend/src/components/AiAnalysisFab.jsx` | `PROVIDER_WEB_URLS.gemini` = `'https://gemini.google.com/app'` |
| Open action | same file | `handleCopyAndOpen()` → copy then `window.open(href, '_blank', ...)` for all providers (including Gemini) |

There is no separate mobile path or app-scheme attempt for Gemini.

---

## Optional: custom scheme as secondary (not implemented)

If we ever need to try a scheme again (e.g. for the Google app’s Gemini tab), a safer pattern than hidden `<a>` + `.click()` is:

1. Use **Universal Link first** (current behavior).
2. Optionally, try scheme with **`window.location.href = appUrl`** and a **shorter fallback (1500–2000 ms)** plus `document.hidden` check before opening the web URL, to avoid long “hang” and reduce "Invalid URL" where the scheme isn’t registered.

Right now we rely only on the Universal Link and do not use any custom scheme.
