# Google Sheets Full-Stack Starter

This project includes:
- `backend`: Express API that reads data from Google Sheets.
- `frontend`: React app that displays rows from the backend.

## 1) Install dependencies

```bash
npm install
npm run install:all
```

## 2) Configure backend environment

Copy the example and fill values:

```bash
cp backend/.env.example backend/.env
```

Required fields in `backend/.env`:
- `GOOGLE_SHEETS_SPREADSHEET_ID`: your Google Sheet ID.
- `GOOGLE_SHEETS_RANGE`: for example `Sheet1!A1:Z100`.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: service account email.
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: private key with `\\n` newlines.

## 3) Share sheet access

Share your Google Sheet with the service account email as **Viewer**.

## 4) Configure frontend environment (optional)

```bash
cp frontend/.env.example frontend/.env
```

Default API URL is `http://localhost:4000`.

## 5) Run full project

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## API

- Health check: `GET /api/health`
- Sheet data: `GET /api/sheet`

Response format:

```json
{
  "headers": ["Name", "Email"],
  "rows": [["Alice", "alice@example.com"], ["Bob", "bob@example.com"]]
}
```

## Cloud Deploy + Cloud Source

See full guide:
- [`DEPLOYMENT.md`](/Users/billyliu/Documents/New%20project/DEPLOYMENT.md)

It includes:
- GitHub setup for cloud source control
- Render deployment using [`render.yaml`](/Users/billyliu/Documents/New%20project/render.yaml)
- Required production environment variables
