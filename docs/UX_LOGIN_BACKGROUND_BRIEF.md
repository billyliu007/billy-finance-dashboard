# Login background – UX design brief

**Product:** My Worth Track  
**Screen:** Login / sign-in only  
**Deliverables:** Background image(s) for desktop and responsive (mobile/tablet) so a UX designer can create or source artwork.

---

## 1. What the app is

**My Worth Track** is a **personal finance dashboard** where users:

- **Sign in** with Google, Apple, or a demo account (one login screen).
- **See their net worth** (cash, debt, assets) and **portfolio** (stocks, crypto) with live market data.
- **Manage** holdings, add/edit cash and debt, and get a **daily net-worth snapshot**.
- **Use AI** (optional) to get portfolio analysis by pasting a generated prompt into ChatGPT, Gemini, etc.

So the login is the **first impression** of a **private, trustworthy, modern finance** product — not playful or consumer-social.

---

## 2. Login screen layout (for safe zones)

- **Full viewport:** The login screen is full viewport (`min-height: 100vh`), centered content.
- **Card:** A single **centered card** (~380px wide on desktop) contains:
  - Title: **“My Worth Track”** (one line)
  - Short line: e.g. “Sign in to access your personal dashboard data.”
  - **Sign in with your account:** Google button, Apple button
  - **Or explore the live demo:** Demo login button
  - Language toggle (English | 中文) and a small hint line under the buttons
- **Background:** Behind the card the background is visible on all sides (top/bottom/left/right). The card has a transparent background so the background image shows through.

So the **important area** is the **center** of the screen; edges and corners can be more decorative or softer.

---

## 3. Current visual context

- **Palette:** Dark theme. Current fallback is:
  - Deep navy/slate base: `#020617` → `#081428`
  - Soft cyan/blue glow from top center: `rgba(56, 189, 248, 0.18)` fading out
- **Feel:** Calm, professional, finance-friendly. No loud gradients or gaming vibe.
- **Card:** Centered, no heavy panel behind it — the new background will sit **behind** this card.

---

## 4. Design direction for the background

- **Mood:** Trust, clarity, control. Feels “finance / dashboard” not “social / entertainment”.
- **Tone:** Calm, minimal, modern. Can be abstract (shapes, gradients, subtle patterns) or very soft imagery (e.g. blurred charts, abstract “growth” or “horizon”).
- **Contrast:** The center will have a transparent card with white/light text and light borders. Background should stay **dark enough** so white/light text and buttons remain readable. Avoid bright hotspots exactly behind the card center.
- **Safe zone:** Keep the **center ~400×500px** (desktop) relatively **low contrast / non-busy** so the card and buttons stay legible. Edges and corners can be richer.

---

## 5. Technical specs

### Desktop

- **Aspect ratio / size:** 1920×1080 (16∶9) or 1440×900 is typical. We can scale/crop; prefer a design that still works when cropped to different aspect ratios (e.g. 16∶9, 16∶10, 4∶3).
- **Format:** PNG (with transparency if needed) or JPG. Export at 1× and, if possible, 2× for retina.
- **Usage:** Used as full-viewport background (e.g. `background-size: cover` or `contain`; `background-position: center`). So the **center** of the image is the most visible; top/bottom may be cropped on very wide or very tall viewports.

### Responsive / mobile

- **Options (pick one or provide both):**
  - **A) Single image:** One image that works for both desktop and mobile (e.g. centered composition, important content in the middle).
  - **B) Two variants:**
    - **Desktop:** e.g. 1920×1080, horizontal.
    - **Mobile/portrait:** e.g. 1080×1920 or 828×1792 (phone), vertical; important content in center so the card stays readable.
- **Safe zone (mobile):** Center ~360×400px (logical) should be low clutter; card is ~380px wide but can be slightly narrower on small screens with padding.

### General

- **File format:** PNG or JPG. Max file size guideline: &lt; 500 KB per asset (after optimization) so the login stays fast.
- **Naming:** e.g. `login-bg-desktop.png`, `login-bg-desktop@2x.png`, `login-bg-mobile.png` (or as agreed).

---

## 6. Copy for UX (summary one-liner)

**App:** My Worth Track — personal finance dashboard (net worth, portfolio, cash/debt, live market data).  
**Screen:** Login only (Google, Apple, Demo).  
**Need:** Full-viewport background image; desktop + optional responsive/mobile variant. Dark, calm, finance-appropriate; center kept clear for a transparent card with light text and buttons.

---

## 7. Checklist for designer

- [ ] Desktop background (e.g. 1920×1080 or 1440×900); center ~400×500px safe for card/text.
- [ ] Optional: mobile/portrait variant (e.g. 1080×1920) with center safe zone.
- [ ] Dark, readable with white/light UI on top; no bright spot directly behind card.
- [ ] Mood: professional, calm, finance/dashboard.
- [ ] Format: PNG or JPG; optimized (&lt; 500 KB per file if possible).
- [ ] Files named clearly (e.g. `login-bg-desktop.png`, `login-bg-mobile.png`).
