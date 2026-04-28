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

Create the extension env file:

```bash
cp apps/extension/.env.example apps/extension/.env
```

Add your OpenAI key in `apps/web/.env`:

```bash
OPENAI_API_KEY="replace-with-openai-key"
OPENAI_MODEL="gpt-5"
OPENAI_STORE_RESPONSES="true"
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

Start the full local dev loop:

```bash
npm run dev
```

That runs the Next.js app and the extension watcher together. If you prefer to split them, use `npm run dev:web` and `npm run dev:extension` in separate terminals.

The extension watcher will:

- rebuild `apps/extension/dist` whenever `apps/extension/src` changes
- read `apps/extension/.env` first for the backend URL and hot-reload settings
- fall back to the local backend during `npm run dev:extension` if no backend URL is set
- publish a local reload stream on `http://127.0.0.1:35729/__hot-reload`

If you want the unpacked extension to hit your local backend during development, change `VIBE_PILOT_BACKEND_URL` in `apps/extension/.env` to `http://127.0.0.1:3001` before running the extension build or watcher.

Build a one-off unpacked extension bundle without the watcher:

```bash
npm run build:extension
```

## Extension Starter Rules

The starter chips in the extension are intentionally constrained:

- `Hello World Pill` is the only toy/demo starter.
- Every other starter must load a concrete, useful rule. The current built-in example is `Make Text Red`, which forces text red with `!important`.
- Starter labels must describe the action or outcome. Do not surface raw page titles, company names, or hostnames as chip text by themselves.

Load it in Chrome:

1. Open `chrome://extensions`.
2. Turn on Developer Mode.
3. Click `Load unpacked`.
4. Choose `/Users/Henry/Developer/vibe-pilot/apps/extension/dist`.
5. Open the extension details page and enable `Allow User Scripts` if Chrome shows that toggle.
6. Click the extension action to open the side panel.
7. Open the extension's Options page if you want the same UI in a normal tab for easier local debugging and automated verification. Keeping the side panel or Options page open lets the watcher trigger automatic extension reloads after file saves.

## Project Map

- [`apps/web/src/app/page.tsx`](/Users/Henry/Developer/vibe-pilot/apps/web/src/app/page.tsx:1): the web dashboard landing page
- [`apps/web/src/app/api/health/route.ts`](/Users/Henry/Developer/vibe-pilot/apps/web/src/app/api/health/route.ts:1): health probe for Railway and local checks
- [`apps/web/src/app/api/rules/route.ts`](/Users/Henry/Developer/vibe-pilot/apps/web/src/app/api/rules/route.ts:1): named rule list/create API
- [`apps/web/src/app/api/rules/[ruleId]/route.ts`](/Users/Henry/Developer/vibe-pilot/apps/web/src/app/api/rules/[ruleId]/route.ts:1): named rule update/delete API
- [`apps/web/src/app/api/assistant/route.ts`](/Users/Henry/Developer/vibe-pilot/apps/web/src/app/api/assistant/route.ts:1): OpenAI-backed chat and tool-loop endpoint for DOM inspection, screenshots, and iterative rule editing
- [`apps/web/prisma/schema.prisma`](/Users/Henry/Developer/vibe-pilot/apps/web/prisma/schema.prisma:1): Postgres schema for saved named rules
- [`apps/extension/scripts/build-extension.mjs`](/Users/Henry/Developer/vibe-pilot/apps/extension/scripts/build-extension.mjs:1): unpacked extension build, generated runtime config, and hot-reload watcher
- [`apps/extension/src/default-draft.js`](/Users/Henry/Developer/vibe-pilot/apps/extension/src/default-draft.js:1): default Hello world sample rule shared by the UI and runtime
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
5. Put that public app URL in `apps/extension/.env` as `VIBE_PILOT_BACKEND_URL` if you want your unpacked extension to talk to production by default.
