import React from 'react';
import {
  Star,
  FolderOpen,
  X,
  Trash2,
  Image,
  Video,
  Film,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { TagFilterDropdown } from './TagFilterDropdown';
import { LibrarySearchField } from './LibrarySearchField';

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

const MEDIA_FILTER_BUTTONS = [
  { type: 'image', label: 'Images', ariaLabel: 'Filter images', Icon: Image },
  { type: 'video', label: 'Videos', ariaLabel: 'Filter videos', Icon: Video },
  { type: 'gif', label: 'GIFs', ariaLabel: 'Filter GIFs', Icon: Film },
] as const;
const SELECTION_ACTIONS_INITIAL = {
  opacity: 0,
  transform: 'scale(0.97)',
};
const SELECTION_ACTIONS_ANIMATE = {
  opacity: 1,
  transform: 'scale(1)',
};
const SELECTION_ACTIONS_EXIT = {
  opacity: 0,
  transform: 'scale(0.985)',
};
const SELECTION_ACTIONS_TRANSITION = {
  duration: 0.14,
  ease: [0.23, 1, 0.32, 1],
} satisfies Transition;
const SELECTION_ACTIONS_REDUCED_TRANSITION = {
  duration: 0,
} satisfies Transition;

function CloudTooltipButton({
  label,
  ariaLabel,
  className,
  onClick,
  children,
}: {
  label: string;
  ariaLabel?: string;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} aria-label={ariaLabel ?? label} className={className}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function getCloudSmallButtonClass(active = false, extraClass = ''): string {
  return `cloud-btn cloud-btn--small ${active ? 'cloud-btn--active' : ''} ${extraClass}`.trim();
}

function getToggledMediaTypes(filterMediaTypes: string[], type: string) {
  return filterMediaTypes.includes(type)
    ? filterMediaTypes.filter((currentType) => currentType !== type)
    : [...filterMediaTypes, type];
}

function ClearAllFiltersButton({
  activeFilterCount,
  onClearAllFilters,
}: {
  activeFilterCount: number;
  onClearAllFilters?: () => void;
}) {
  if (activeFilterCount <= 0 || !onClearAllFilters) return null;

  return (
    <CloudTooltipButton
      label="Clear All Filters"
      ariaLabel="Clear all filters"
      onClick={onClearAllFilters}
      className={getCloudSmallButtonClass(true, 'relative')}
    >
      <X className="w-[15px] h-[15px]" />
      <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-[var(--accent-500)] text-white text-[9px] font-bold flex items-center justify-center leading-none px-0.5">
        {activeFilterCount}
      </span>
    </CloudTooltipButton>
  );
}

function SelectionActions({
  selectedCount,
  onDeleteSelected,
  onClearSelection,
}: Pick<GlassBlobToolbarProps, 'selectedCount' | 'onDeleteSelected' | 'onClearSelection'>) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {selectedCount > 0 && (
        <motion.div
          className="cloud-selection-actions"
          initial={shouldReduceMotion ? false : SELECTION_ACTIONS_INITIAL}
          animate={SELECTION_ACTIONS_ANIMATE}
          exit={shouldReduceMotion ? undefined : SELECTION_ACTIONS_EXIT}
          transition={
            shouldReduceMotion
              ? SELECTION_ACTIONS_REDUCED_TRANSITION
              : SELECTION_ACTIONS_TRANSITION
          }
        >
          <div className="cloud-divider" />

          <div className="cloud-selection">
            <span className="cloud-selection__count">{selectedCount}</span>
          </div>

          <CloudTooltipButton
            label="Delete Selected"
            ariaLabel="Delete selected"
            onClick={onDeleteSelected}
            className={getCloudSmallButtonClass(false, 'cloud-btn--danger')}
          >
            <Trash2 className="w-[15px] h-[15px]" />
          </CloudTooltipButton>

          <CloudTooltipButton
            label="Clear Selection"
            ariaLabel="Clear selection"
            onClick={onClearSelection}
            className={getCloudSmallButtonClass()}
          >
            <X className="w-[15px] h-[15px]" />
          </CloudTooltipButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
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
  const toggleMediaType = (type: string) => {
    onFilterMediaTypesChange(getToggledMediaTypes(filterMediaTypes, type));
  };

  return (
    <div className="cloud-toolbar" role="toolbar" aria-label="Library filters and actions">
      <div className="cloud-toolbar__glass" />
      <div className="cloud-toolbar__inner">
        <div className="cloud-toolbar__row cloud-toolbar__row--secondary">
          <div className="cloud-toolbar__action-strip">
            <CloudTooltipButton
              label="Favorites"
              ariaLabel="Toggle favorites filter"
              onClick={() => onFilterFavoritesChange(!filterFavorites)}
              className={getCloudSmallButtonClass(filterFavorites)}
            >
              <Star className="w-[15px] h-[15px]" fill={filterFavorites ? 'currentColor' : 'none'} />
            </CloudTooltipButton>

            <TagFilterDropdown
              allTags={allTags}
              selectedTags={filterTags}
              onSelectionChange={onFilterTagsChange}
            />

            {MEDIA_FILTER_BUTTONS.map(({ type, label, ariaLabel, Icon }) => (
              <CloudTooltipButton
                key={type}
                label={label}
                ariaLabel={ariaLabel}
                onClick={() => toggleMediaType(type)}
                className={getCloudSmallButtonClass(filterMediaTypes.includes(type))}
              >
                <Icon className="w-[15px] h-[15px]" />
              </CloudTooltipButton>
            ))}

            <ClearAllFiltersButton
              activeFilterCount={activeFilterCount}
              onClearAllFilters={onClearAllFilters}
            />

            <SelectionActions
              selectedCount={selectedCount}
              onDeleteSelected={onDeleteSelected}
              onClearSelection={onClearSelection}
            />
          </div>
        </div>

        <div className="cloud-toolbar__row cloud-toolbar__row--primary">
          <LibrarySearchField
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
          />

          <CloudTooltipButton
            label="Open Folder"
            ariaLabel="Open folder"
            onClick={onOpenLibraryFolder}
            className={getCloudSmallButtonClass()}
          >
            <FolderOpen className="w-[15px] h-[15px]" />
          </CloudTooltipButton>
        </div>

      </div>
    </div>
  );
};
