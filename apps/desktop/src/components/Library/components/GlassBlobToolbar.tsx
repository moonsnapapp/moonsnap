import React, { useState, useRef, useEffect } from 'react';
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
}) => {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchExpanded && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchExpanded]);

  const handleSearchToggle = () => {
    if (searchExpanded && searchQuery) {
      onSearchChange('');
    }
    setSearchExpanded(!searchExpanded);
  };

  const handleSearchBlur = () => {
    if (!searchQuery) {
      setSearchExpanded(false);
    }
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
      setSearchExpanded(false);
      searchInputRef.current?.blur();
    }
  };
  return (
    <div className="cloud-toolbar">
      <div className="cloud-toolbar__glass" />
      <div className="cloud-toolbar__inner">
        {/* LEFT: Search, Folder, Favorites */}
        <div className={`cloud-search ${searchExpanded ? 'cloud-search--expanded' : ''}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleSearchToggle}
                className={`cloud-btn cloud-btn--small ${searchQuery ? 'cloud-btn--active' : ''}`}
              >
                {searchExpanded && searchQuery ? (
                  <X className="w-[15px] h-[15px]" />
                ) : (
                  <Search className="w-[15px] h-[15px]" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">{searchExpanded ? 'Clear Search' : 'Search'}</p>
            </TooltipContent>
          </Tooltip>
          {searchExpanded && (
          <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onBlur={handleSearchBlur}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search..."
              className="cloud-search__input"
            />
          )}
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={onOpenLibraryFolder} className="cloud-btn cloud-btn--small">
              <FolderOpen className="w-[15px] h-[15px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">Open Folder</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onFilterFavoritesChange(!filterFavorites)}
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
              className={`cloud-btn cloud-btn--small ${filterMediaTypes.includes('gif') ? 'cloud-btn--active' : ''}`}
            >
              <Film className="w-[15px] h-[15px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">GIFs</p>
          </TooltipContent>
        </Tooltip>

        {/* Selection actions - appended on right */}
        {selectedCount > 0 && (
          <>
            <div className="cloud-divider" />

            <div className="cloud-selection">
              <span className="cloud-selection__count">{selectedCount}</span>
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={onDeleteSelected} className="cloud-btn cloud-btn--small cloud-btn--danger">
                  <Trash2 className="w-[15px] h-[15px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">Delete Selected</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={onClearSelection} className="cloud-btn cloud-btn--small">
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
  );
};
