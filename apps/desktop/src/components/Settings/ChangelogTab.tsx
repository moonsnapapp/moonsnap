import React from 'react';
import { changelog } from '@snapit/changelog';

const formatReleaseDate = (value: string): string => {
  const parsedDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const renderItem = (item: string): React.ReactNode => {
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

export const ChangelogTab: React.FC = () => {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Release Notes
        </h3>
      </section>

      {changelog.entries.map((entry) => (
        <section
          key={entry.version}
          className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)]"
        >
          <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
            <h4 className="text-sm font-semibold text-[var(--ink-black)]">v{entry.version}</h4>
            <span className="text-xs text-[var(--ink-muted)]">{formatReleaseDate(entry.date)}</span>
          </div>

          <div className="space-y-3">
            {entry.sections.map((section) => (
              <div key={`${entry.version}-${section.title}`}>
                <h5 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)] mb-1">
                  {section.title}
                </h5>
                <ul className="list-disc pl-5 space-y-1">
                  {section.items.map((item) => (
                    <li key={`${entry.version}-${section.title}-${item}`} className="text-sm text-[var(--ink-black)]">
                      {renderItem(item)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};
