import { getPrisma } from "@/lib/db";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

async function getDashboardSnapshot() {
  try {
    const prisma = await getPrisma();
    const [ruleCount, latestRules] = await Promise.all([
      prisma.rule.count(),
      prisma.rule.findMany({
        orderBy: {
          updatedAt: "desc",
        },
        take: 6,
        select: {
          id: true,
          name: true,
          matchPattern: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      databaseReady: true,
      ruleCount,
      latestRules,
      databaseMessage: "Postgres is connected and ready for named rule storage.",
    };
  } catch (error) {
    return {
      databaseReady: false,
      ruleCount: 0,
      latestRules: [],
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
            It owns Prisma, Postgres, Railway deploys, named rule persistence,
            and the OpenAI loop that lets Vibe Pilot inspect a page, capture
            screenshots, and iterate on edits inside one prompt.
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
            <li>API routes for saving, updating, listing, and deleting rules</li>
            <li>OpenAI assistant orchestration for tool-driven page editing</li>
            <li>Prisma client and Postgres schema ownership</li>
            <li>Railway deployment target for production</li>
          </ul>
        </article>

        <article className={styles.card}>
          <span className={styles.label}>Extension</span>
          <h2>What stays in Chrome</h2>
          <ul className={styles.list}>
            <li>Side panel chat and page-edit UI</li>
            <li>Content script DOM inspection and scrolling tools</li>
            <li>Live rule registration, screenshots, and page injection</li>
          </ul>
        </article>

        <article className={styles.card}>
          <span className={styles.label}>Persistence</span>
          <h2>Current rule inventory</h2>
          <p className={styles.metric}>{snapshot.ruleCount}</p>
          <p className={styles.cardCopy}>Saved named rules in Postgres.</p>
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
              <code>GET /api/rules?limit=25</code>
              <p>Returns saved rules for the extension or dashboard.</p>
            </div>
            <div className={styles.endpoint}>
              <code>POST /api/rules</code>
              <p>Creates a new named rule from the extension or future chat loop.</p>
            </div>
            <div className={styles.endpoint}>
              <code>PATCH /api/rules/:id</code>
              <p>Updates an existing named rule after edits from the extension.</p>
            </div>
            <div className={styles.endpoint}>
              <code>DELETE /api/rules/:id</code>
              <p>Deletes a saved rule from the rules tab or dashboard.</p>
            </div>
            <div className={styles.endpoint}>
              <code>POST /api/assistant</code>
              <p>
                Runs the Vibe Pilot assistant loop so the extension can inspect the
                page, call local tools, and continue until it has an answer or edit.
              </p>
            </div>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.label}>Recent rules</span>
              <h2>Latest saved items</h2>
            </div>
          </div>
          {snapshot.latestRules.length > 0 ? (
            <div className={styles.draftList}>
              {snapshot.latestRules.map((rule) => (
                <div className={styles.draftCard} key={rule.id}>
                  <strong>{rule.name}</strong>
                  <p>{rule.matchPattern}</p>
                  <span>
                    updated{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(rule.updatedAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              No saved rules yet. Create one from the extension to populate this inventory.
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
