import React, { useRef } from 'react';
import {
  Star,
  FolderOpen,
  Search,
  X,
  Trash2,
  Image,
  Video,
  Film,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { TagFilterDropdown } from './TagFilterDropdown';

interface GlassBlobToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterFavorites: boolean;
  onFilterFavoritesChange: (value: boolean) => void;
  filterTags: string[];
  onFilterTagsChange: (tags: string[]) => void;
  allTags: string[];
  filterMediaTypes: string[];
  onFilterMediaTypesChange: (types: string[]) => void;
  selectedCount: number;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
  onOpenLibraryFolder: () => void;
  activeFilterCount?: number;
  onClearAllFilters?: () => void;
}

export const GlassBlobToolbar: React.FC<GlassBlobToolbarProps> = ({
  searchQuery,
  onSearchChange,
  filterFavorites,
  onFilterFavoritesChange,
  filterTags,
  onFilterTagsChange,
  allTags,
  filterMediaTypes,
  onFilterMediaTypesChange,
  selectedCount,
  onDeleteSelected,
  onClearSelection,
  onOpenLibraryFolder,
  activeFilterCount = 0,
  onClearAllFilters,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearchToggle = () => {
    if (searchQuery) {
      onSearchChange('');
      searchInputRef.current?.focus();
      return;
    }
    searchInputRef.current?.focus();
  };

  const toggleMediaType = (type: string) => {
    if (filterMediaTypes.includes(type)) {
      onFilterMediaTypesChange(filterMediaTypes.filter((t) => t !== type));
    } else {
      onFilterMediaTypesChange([...filterMediaTypes, type]);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onSearchChange('');
      searchInputRef.current?.blur();
    }
  };
  return (
    <div className="cloud-toolbar" role="toolbar" aria-label="Library filters and actions">
      <div className="cloud-toolbar__glass" />
      <div className="cloud-toolbar__inner">
        <div className="cloud-toolbar__row cloud-toolbar__row--secondary">
          <div className="cloud-toolbar__action-strip">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onFilterFavoritesChange(!filterFavorites)}
                  aria-label="Toggle favorites filter"
                  className={`cloud-btn cloud-btn--small ${filterFavorites ? 'cloud-btn--active' : ''}`}
                >
                  <Star className="w-[15px] h-[15px]" fill={filterFavorites ? 'currentColor' : 'none'} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">Favorites</p>
              </TooltipContent>
            </Tooltip>

            <TagFilterDropdown
              allTags={allTags}
              selectedTags={filterTags}
              onSelectionChange={onFilterTagsChange}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => toggleMediaType('image')}
                  aria-label="Filter images"
                  className={`cloud-btn cloud-btn--small ${filterMediaTypes.includes('image') ? 'cloud-btn--active' : ''}`}
                >
                  <Image className="w-[15px] h-[15px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">Images</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => toggleMediaType('video')}
                  aria-label="Filter videos"
                  className={`cloud-btn cloud-btn--small ${filterMediaTypes.includes('video') ? 'cloud-btn--active' : ''}`}
                >
                  <Video className="w-[15px] h-[15px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">Videos</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => toggleMediaType('gif')}
                  aria-label="Filter GIFs"
                  className={`cloud-btn cloud-btn--small ${filterMediaTypes.includes('gif') ? 'cloud-btn--active' : ''}`}
                >
                  <Film className="w-[15px] h-[15px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">GIFs</p>
              </TooltipContent>
            </Tooltip>

            {activeFilterCount > 0 && onClearAllFilters && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onClearAllFilters}
                    aria-label="Clear all filters"
                    className="cloud-btn cloud-btn--small cloud-btn--active relative"
                  >
                    <X className="w-[15px] h-[15px]" />
                    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-[var(--coral-500)] text-white text-[9px] font-bold flex items-center justify-center leading-none px-0.5">
                      {activeFilterCount}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">Clear All Filters</p>
                </TooltipContent>
              </Tooltip>
            )}

            {selectedCount > 0 && (
              <>
                <div className="cloud-divider" />

                <div className="cloud-selection">
                  <span className="cloud-selection__count">{selectedCount}</span>
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={onDeleteSelected} aria-label="Delete selected" className="cloud-btn cloud-btn--small cloud-btn--danger">
                      <Trash2 className="w-[15px] h-[15px]" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Delete Selected</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={onClearSelection} aria-label="Clear selection" className="cloud-btn cloud-btn--small">
                      <X className="w-[15px] h-[15px]" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Clear Selection</p>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        </div>

        <div className="cloud-toolbar__row cloud-toolbar__row--primary">
          <div className="cloud-search cloud-search--expanded">
            {searchQuery ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleSearchToggle}
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
            ) : (
              <Search className="cloud-search__icon" aria-hidden="true" />
            )}
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search..."
              className="cloud-search__input"
            />
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={onOpenLibraryFolder} aria-label="Open folder" className="cloud-btn cloud-btn--small">
                <FolderOpen className="w-[15px] h-[15px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Open Folder</p>
            </TooltipContent>
          </Tooltip>
        </div>

      </div>
    </div>
  );
};
