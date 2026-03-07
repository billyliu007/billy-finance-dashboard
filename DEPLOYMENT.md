# Cloud Hosting + Cloud Source Management

This project is ready to deploy with:
- Source code in **GitHub**
- Hosting on **Render** (frontend + backend)

## 1) Put source code in GitHub

1. Create a new GitHub repo (empty repo).
2. Run in this project root:

```bash
git add .
git commit -m "Prepare cloud deployment"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

If `origin` already exists:

```bash
git remote set-url origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## 2) Deploy on Render using Blueprint

1. Go to Render dashboard.
2. Choose **New +** -> **Blueprint**.
3. Connect your GitHub repo.
4. Render will detect [`render.yaml`](render.yaml) and create two services:
   - `billy-finance-backend`
   - `billy-finance-frontend`

## 3) Configure backend environment variables in Render

Set these on `billy-finance-backend`:
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SHEETS_RANGE`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

Use the private key with literal `\\n` newlines in one line, for example:

```env
-----BEGIN PRIVATE KEY-----\\nABC...\\n-----END PRIVATE KEY-----\\n
```

## 4) Point frontend to backend URL

After backend deploys, copy backend URL and set this on `billy-finance-frontend`:
- `VITE_API_BASE_URL=https://<your-backend>.onrender.com`

Then redeploy frontend service.

## 5) Day-2 workflow (cloud source managed)

For every change:

```bash
git add .
git commit -m "your change"
git push
```

Render auto-deploys from GitHub.

## Optional recommendation

- Add branch protection on `main` in GitHub.
- Use pull requests for safer production changes.
