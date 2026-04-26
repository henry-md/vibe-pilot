import { getPrisma } from "@/lib/db";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

async function getDashboardSnapshot() {
  try {
    const prisma = await getPrisma();
    const [draftCount, latestDrafts] = await Promise.all([
      prisma.scriptDraft.count(),
      prisma.scriptDraft.findMany({
        orderBy: {
          updatedAt: "desc",
        },
        take: 3,
        select: {
          id: true,
          name: true,
          source: true,
          targetUrl: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      databaseReady: true,
      draftCount,
      latestDrafts,
      databaseMessage: "Postgres is connected and ready for extension draft storage.",
    };
  } catch (error) {
    return {
      databaseReady: false,
      draftCount: 0,
      latestDrafts: [],
      databaseMessage:
        error instanceof Error
          ? error.message
          : "The database is not reachable yet.",
    };
  }
}

export default async function Home() {
  const snapshot = await getDashboardSnapshot();

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Apps/Web</p>
          <h1>Vibe Pilot web app and backend</h1>
          <p className={styles.lead}>
            This Next.js app is now the real backend surface for the extension.
            It owns Prisma, Postgres, Railway deploys, and the first persistence
            API for script drafts.
          </p>
        </div>
        <div className={styles.heroCard}>
          <span className={styles.label}>Database</span>
          <strong>{snapshot.databaseReady ? "Connected" : "Waiting on setup"}</strong>
          <p>{snapshot.databaseMessage}</p>
        </div>
      </section>

      <section className={styles.cardGrid}>
        <article className={styles.card}>
          <span className={styles.label}>Web app</span>
          <h2>What lives here</h2>
          <ul className={styles.list}>
            <li>API routes for saving and reading script drafts</li>
            <li>Prisma client and Postgres schema ownership</li>
            <li>Railway deployment target for production</li>
          </ul>
        </article>

        <article className={styles.card}>
          <span className={styles.label}>Extension</span>
          <h2>What stays in Chrome</h2>
          <ul className={styles.list}>
            <li>Side panel chat and editor UI</li>
            <li>Content script DOM inspection</li>
            <li>`userScripts` registration and page injection</li>
          </ul>
        </article>

        <article className={styles.card}>
          <span className={styles.label}>Persistence</span>
          <h2>Current draft inventory</h2>
          <p className={styles.metric}>{snapshot.draftCount}</p>
          <p className={styles.cardCopy}>Saved remote drafts in Postgres.</p>
        </article>
      </section>

      <section className={styles.panelGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.label}>API surface</span>
              <h2>Routes ready now</h2>
            </div>
          </div>
          <div className={styles.endpointList}>
            <div className={styles.endpoint}>
              <code>GET /api/health</code>
              <p>Confirms the app is live and reports database connectivity.</p>
            </div>
            <div className={styles.endpoint}>
              <code>GET /api/script-drafts?limit=5</code>
              <p>Returns recent saved drafts for the extension or dashboard.</p>
            </div>
            <div className={styles.endpoint}>
              <code>POST /api/script-drafts</code>
              <p>Saves a new draft payload from the extension or future chat loop.</p>
            </div>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.label}>Recent drafts</span>
              <h2>Latest saved items</h2>
            </div>
          </div>
          {snapshot.latestDrafts.length > 0 ? (
            <div className={styles.draftList}>
              {snapshot.latestDrafts.map((draft) => (
                <div className={styles.draftCard} key={draft.id}>
                  <strong>{draft.name}</strong>
                  <p>{draft.targetUrl ?? "No target URL saved yet."}</p>
                  <span>
                    {draft.source} · updated{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(draft.updatedAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              No remote drafts yet. Save one from the extension side panel once
              the backend URL is set.
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
