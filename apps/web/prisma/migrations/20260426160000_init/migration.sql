-- CreateTable
CREATE TABLE "ScriptDraft" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Untitled draft',
    "source" TEXT NOT NULL DEFAULT 'extension',
    "targetUrl" TEXT,
    "targetTitle" TEXT,
    "matchPattern" TEXT NOT NULL DEFAULT '*://*/*',
    "html" TEXT NOT NULL DEFAULT '',
    "css" TEXT NOT NULL DEFAULT '',
    "javascript" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptDraft_pkey" PRIMARY KEY ("id")
);

