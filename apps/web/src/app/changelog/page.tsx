import Link from "next/link";
import type { ReactNode } from "react";
import { getChangelogDocument } from "@/lib/releaseData";

const formatReleaseDate = (value: string): string => {
  const parsedDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const renderItem = (item: string): ReactNode => {
  const emphasizedMatch = item.match(/^\*\*(.+?)\*\*\s*-\s*(.+)$/);
  if (!emphasizedMatch) {
    return item;
  }

  return (
    <>
      <span className="font-medium">{emphasizedMatch[1]}</span>
      {` - ${emphasizedMatch[2]}`}
    </>
  );
};

export default async function ChangelogPage() {
  const changelog = await getChangelogDocument();

  return (
    <main className="relative min-h-screen px-6 py-20">
      <div className="fixed inset-0 grid-pattern pointer-events-none" />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% -20%, rgba(255, 77, 77, 0.14) 0%, transparent 55%)",
        }}
      />

      <div className="relative max-w-4xl mx-auto">
        <div className="mb-10">
          <Link
            href="/"
            className="inline-flex items-center text-sm text-[var(--muted)] hover:text-white transition-colors mb-4"
          >
            {"<-"} Back to home
          </Link>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-3 font-display">Changelog</h1>
        </div>

        <div className="space-y-6">
          {changelog.entries.map((entry) => (
            <article
              key={entry.version}
              className="glass rounded-2xl border border-[var(--border)] p-6"
            >
              <header className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h2 className="text-2xl font-semibold tracking-tight font-display">v{entry.version}</h2>
                <time className="text-sm text-[var(--muted)]">{formatReleaseDate(entry.date)}</time>
              </header>

              <div className="space-y-4">
                {entry.sections.map((section) => (
                  <section key={`${entry.version}-${section.title}`}>
                    <h3 className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1">
                      {section.title}
                    </h3>
                    <ul className="list-disc pl-5 space-y-1">
                      {section.items.map((item) => (
                        <li key={`${entry.version}-${section.title}-${item}`} className="text-sm text-[var(--foreground)]">
                          {renderItem(item)}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
