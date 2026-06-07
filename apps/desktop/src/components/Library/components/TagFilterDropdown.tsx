import React, { useState } from 'react';
import { Tag, X, Check } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface TagFilterDropdownProps {
  allTags: string[];
  selectedTags: string[];
  onSelectionChange: (tags: string[]) => void;
}

function getFilteredTags(allTags: string[], searchQuery: string): string[] {
  const normalizedQuery = searchQuery.toLowerCase();
  return allTags.filter((tag) => tag.toLowerCase().includes(normalizedQuery));
}

function getNextSelectedTags(selectedTags: string[], tag: string): string[] {
  return selectedTags.includes(tag)
    ? selectedTags.filter((selectedTag) => selectedTag !== tag)
    : [...selectedTags, tag];
}

function getEmptyTagMessage(allTags: string[]): string {
  return allTags.length === 0 ? 'No tags yet' : 'No matching tags';
}

function TagFilterBadge({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }

  return (
    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--accent-400)] text-white text-[9px] font-bold flex items-center justify-center">
      {count}
    </span>
  );
}

function TagOption({
  tag,
  selected,
  onToggle,
}: {
  tag: string;
  selected: boolean;
  onToggle: (tag: string) => void;
}) {
  return (
    <button
      key={tag}
      onClick={() => onToggle(tag)}
      className={`
        w-full px-3 py-1.5 text-left text-sm flex items-center gap-2
        transition-colors hover:bg-[var(--polar-mist)]
        ${selected ? 'text-[var(--accent-400)]' : 'text-[var(--ink-base)]'}
      `}
    >
      <div className={`
        w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
        ${selected
          ? 'bg-[var(--accent-400)] border-[var(--accent-400)]'
          : 'border-[var(--polar-frost)]'
        }
      `}>
        {selected && <Check className="w-3 h-3 text-white" />}
      </div>
      <span className="truncate">{tag}</span>
    </button>
  );
}

export const TagFilterDropdown: React.FC<TagFilterDropdownProps> = ({
  allTags,
  selectedTags,
  onSelectionChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTags = getFilteredTags(allTags, searchQuery);

  const toggleTag = (tag: string) => {
    onSelectionChange(getNextSelectedTags(selectedTags, tag));
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  const hasActiveFilter = selectedTags.length > 0;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
              <button
                className={`cloud-btn cloud-btn--small relative ${hasActiveFilter ? 'cloud-btn--active' : ''}`}
              >
                <Tag className="w-[15px] h-[15px]" />
                <TagFilterBadge count={selectedTags.length} />
              </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">Filter by tags</p>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="start"
        side="top"
        className="w-56 p-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="p-2 border-b border-[var(--polar-frost)]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tags..."
            className="w-full px-2 py-1.5 text-sm rounded border border-[var(--polar-frost)]
              bg-[var(--card)] text-[var(--ink-base)]
              placeholder:text-[var(--ink-muted)]
              focus:outline-none"
          />
        </div>

        <div className="max-h-48 overflow-y-auto">
          {filteredTags.length === 0 ? (
            <p className="text-xs text-[var(--ink-muted)] text-center py-4">
              {getEmptyTagMessage(allTags)}
            </p>
          ) : (
            <div className="py-1">
              {filteredTags.map((tag) => (
                <TagOption
                  key={tag}
                  tag={tag}
                  selected={selectedTags.includes(tag)}
                  onToggle={toggleTag}
                />
              ))}
            </div>
          )}
        </div>

        {hasActiveFilter && (
          <div className="p-2 border-t border-[var(--polar-frost)]">
            <button
              onClick={clearAll}
              className="w-full px-2 py-1.5 text-xs text-[var(--ink-subtle)] hover:text-[var(--ink-base)]
                flex items-center justify-center gap-1 rounded hover:bg-[var(--polar-mist)] transition-colors"
            >
              <X className="w-3 h-3" />
              Clear all filters
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
