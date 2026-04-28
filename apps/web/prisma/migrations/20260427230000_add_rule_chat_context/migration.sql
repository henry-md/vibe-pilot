ALTER TABLE "Rule"
ADD COLUMN "chatMessages" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN "chatPreviousResponseId" TEXT;
