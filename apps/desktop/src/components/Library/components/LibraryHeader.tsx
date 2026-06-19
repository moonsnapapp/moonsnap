import React from 'react';
import {
  Star,
  LayoutGrid,
  List,
  FolderOpen,
  X,
  Trash2,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { TagFilterDropdown } from './TagFilterDropdown';
import { LibrarySearchField } from './LibrarySearchField';

type LibraryViewMode = 'grid' | 'list';

interface LibraryHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterFavorites: boolean;
  onFilterFavoritesChange: (value: boolean) => void;
  filterTags: string[];
  onFilterTagsChange: (tags: string[]) => void;
  allTags: string[];
  viewMode: LibraryViewMode;
  onViewModeChange: (mode: LibraryViewMode) => void;
  selectedCount: number;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
  onOpenLibraryFolder: () => void;
}

type LibrarySearchProps = Pick<LibraryHeaderProps, 'searchQuery' | 'onSearchChange'>;

function LibrarySearch({ searchQuery, onSearchChange }: LibrarySearchProps) {
  return (
    <div className="library-header__section">
      <LibrarySearchField searchQuery={searchQuery} onSearchChange={onSearchChange} />
    </div>
  );
}

function HeaderTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function LibraryFilters({
  filterFavorites,
  onFilterFavoritesChange,
  filterTags,
  onFilterTagsChange,
  allTags,
  onOpenLibraryFolder,
}: Pick<
  LibraryHeaderProps,
  | 'filterFavorites'
  | 'onFilterFavoritesChange'
  | 'filterTags'
  | 'onFilterTagsChange'
  | 'allTags'
  | 'onOpenLibraryFolder'
>) {
  return (
    <div className="library-header__section library-header__section--center">
      <HeaderTooltip label="Favorites">
        <button
          onClick={() => onFilterFavoritesChange(!filterFavorites)}
          aria-label="Toggle favorites filter"
          className={`library-header__btn ${filterFavorites ? 'library-header__btn--active' : ''}`}
        >
          <Star className="w-4 h-4" fill={filterFavorites ? 'currentColor' : 'none'} />
        </button>
      </HeaderTooltip>

      <TagFilterDropdown
        allTags={allTags}
        selectedTags={filterTags}
        onSelectionChange={onFilterTagsChange}
      />

      <div className="library-header__divider" />

      <HeaderTooltip label="Open Folder">
        <button
          onClick={onOpenLibraryFolder}
          aria-label="Open library folder"
          className="library-header__btn"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
      </HeaderTooltip>
    </div>
  );
}

function SelectionActions({
  selectedCount,
  onDeleteSelected,
  onClearSelection,
}: Pick<
  LibraryHeaderProps,
  'selectedCount' | 'onDeleteSelected' | 'onClearSelection'
>) {
  if (selectedCount <= 0) return null;

  return (
    <>
      <div className="library-header__selection">
        <span className="library-header__selection-count">{selectedCount}</span>
        <span className="library-header__selection-label">selected</span>
      </div>

      <HeaderTooltip label="Delete">
        <button
          onClick={onDeleteSelected}
          aria-label="Delete selected captures"
          className="library-header__btn library-header__btn--danger"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </HeaderTooltip>

      <HeaderTooltip label="Clear">
        <button
          onClick={onClearSelection}
          aria-label="Clear selection"
          className="library-header__btn"
        >
          <X className="w-4 h-4" />
        </button>
      </HeaderTooltip>

      <div className="library-header__divider" />
    </>
  );
}

function ViewModeToggle({
  viewMode,
  onViewModeChange,
}: Pick<LibraryHeaderProps, 'viewMode' | 'onViewModeChange'>) {
  return (
    <div className="library-header__view-toggle">
      <button
        onClick={() => onViewModeChange('grid')}
        aria-label="Grid view"
        className={`library-header__view-btn ${viewMode === 'grid' ? 'library-header__view-btn--active' : ''}`}
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
      <button
        onClick={() => onViewModeChange('list')}
        aria-label="List view"
        className={`library-header__view-btn ${viewMode === 'list' ? 'library-header__view-btn--active' : ''}`}
      >
        <List className="w-4 h-4" />
      </button>
    </div>
  );
}

export const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  searchQuery,
  onSearchChange,
  filterFavorites,
  onFilterFavoritesChange,
  filterTags,
  onFilterTagsChange,
  allTags,
  viewMode,
  onViewModeChange,
  selectedCount,
  onDeleteSelected,
  onClearSelection,
  onOpenLibraryFolder,
}) => {
  return (
    <header className="library-header">
      <div className="library-header__inner">
        <LibrarySearch searchQuery={searchQuery} onSearchChange={onSearchChange} />

        <LibraryFilters
          filterFavorites={filterFavorites}
          onFilterFavoritesChange={onFilterFavoritesChange}
          filterTags={filterTags}
          onFilterTagsChange={onFilterTagsChange}
          allTags={allTags}
          onOpenLibraryFolder={onOpenLibraryFolder}
        />

        <div className="library-header__section library-header__section--right">
          <SelectionActions
            selectedCount={selectedCount}
            onDeleteSelected={onDeleteSelected}
            onClearSelection={onClearSelection}
          />
          <ViewModeToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
        </div>
      </div>
    </header>
  );
};
