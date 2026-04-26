## Vibe Pilot

This repo is now split into two clear apps:

- [`apps/web`](/Users/Henry/Developer/vibe-pilot/apps/web/package.json:1): the real Next.js web app and backend API. It owns Prisma, Postgres access, and deploys to Railway.
- [`apps/extension`](/Users/Henry/Developer/vibe-pilot/apps/extension/package.json:1): the unpacked Chrome extension. It owns the side panel, content script, and `userScripts` runtime.

## Development

Install dependencies once from the repo root:

```bash
npm install
```

Create the web env file:

```bash
cp apps/web/.env.example apps/web/.env
```

Start local Postgres:

```bash
npm run db:start
```

Run Prisma locally:

```bash
npm run prisma:migrate -- --name init
```

Start the web app:

```bash
npm run dev:web
```

The local backend will default to [http://127.0.0.1:3001](http://127.0.0.1:3001) on this machine because port `3000` is already in use elsewhere. You can still override `PORT` if you want a different port.

Build the unpacked extension:

```bash
npm run build:extension
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Turn on Developer Mode.
3. Click `Load unpacked`.
4. Choose `/Users/Henry/Developer/vibe-pilot/apps/extension/dist`.
5. Open the extension details page and enable `Allow User Scripts` if Chrome shows that toggle.
6. Click the extension action to open the side panel.
7. Open the extension's Options page if you want the same UI in a normal tab for easier local debugging and automated verification.

## Project Map

- [`apps/web/src/app/page.tsx`](/Users/Henry/Developer/vibe-pilot/apps/web/src/app/page.tsx:1): the web dashboard landing page
- [`apps/web/src/app/api/health/route.ts`](/Users/Henry/Developer/vibe-pilot/apps/web/src/app/api/health/route.ts:1): health probe for Railway and local checks
- [`apps/web/src/app/api/script-drafts/route.ts`](/Users/Henry/Developer/vibe-pilot/apps/web/src/app/api/script-drafts/route.ts:1): draft persistence API
- [`apps/web/prisma/schema.prisma`](/Users/Henry/Developer/vibe-pilot/apps/web/prisma/schema.prisma:1): Postgres schema for saved script drafts
- [`apps/extension/src/service-worker.js`](/Users/Henry/Developer/vibe-pilot/apps/extension/src/service-worker.js:1): extension orchestration, local storage, remote save/load
- [`apps/extension/src/sidepanel.js`](/Users/Henry/Developer/vibe-pilot/apps/extension/src/sidepanel.js:1): extension UI logic

## Railway

This repo includes a root [`railway.json`](/Users/Henry/Developer/vibe-pilot/railway.json:1) that tells Railway to:

- build the web app with `npm run build:web`
- start the web app with `npm run start:web`
- run Prisma migrations before deploy with `npm run prisma:deploy`

On Railway you still need to:

1. Create a new project from this repo.
2. Add a PostgreSQL service.
3. In the web service, add a reference variable for `DATABASE_URL` from the Postgres service.
4. Generate a public domain for the web service.
5. Put that public URL into the extension side panel as the backend URL when you want remote draft saves outside local development.
