import React, { useRef } from 'react';
import { Search, X } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface LibrarySearchFieldProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  placeholder?: string;
  className?: string;
}

function SearchLeadingControl({
  searchQuery,
  onClearSearch,
}: {
  searchQuery: string;
  onClearSearch: () => void;
}) {
  if (!searchQuery) {
    return <Search className="cloud-search__icon" aria-hidden="true" />;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClearSearch}
          aria-label="Clear search"
          className="cloud-search__icon-btn"
        >
          <X className="w-[15px] h-[15px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">Clear Search</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Shared search input used by every library surface (full library toolbar and
 * the editor-view sidebar). Owning the markup, behavior, and the inset
 * `.cloud-search` styling in one place keeps the two views from drifting apart.
 */
export function LibrarySearchField({
  searchQuery,
  onSearchChange,
  placeholder = 'Search...',
  className,
}: LibrarySearchFieldProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleClearSearch = () => {
    onSearchChange('');
    searchInputRef.current?.focus();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onSearchChange('');
      searchInputRef.current?.blur();
    }
  };

  return (
    <div className={`cloud-search cloud-search--expanded ${className ?? ''}`.trim()}>
      <SearchLeadingControl searchQuery={searchQuery} onClearSearch={handleClearSearch} />
      <input
        ref={searchInputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        placeholder={placeholder}
        className="cloud-search__input"
      />
    </div>
  );
}
