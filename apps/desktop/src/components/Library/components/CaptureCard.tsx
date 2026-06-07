import React, { memo, useState, useMemo, useEffect, useRef } from 'react';
import { Star, Trash2, Check, Loader2, AlertTriangle, Video, Film, Tag, Info, Eye } from 'lucide-react';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CaptureContextMenu } from './CaptureContextMenu';
import { TagChip } from './TagChip';
import { TagPopover } from './TagPopover';
import { getCaptureCardThumbnailFit } from './thumbnailPresentation';
import { useInViewAnimation, getCachedThumbnailUrl } from '../hooks';
import type { CaptureCardProps } from './types';
import { capturePropsAreEqual } from './types';

// Check if capture is a video or gif recording
const isVideoOrGif = (captureType: string) => captureType === 'video' || captureType === 'gif';

type CaptureCardCapture = CaptureCardProps['capture'];
type ThumbnailFit = ReturnType<typeof getCaptureCardThumbnailFit>;

interface CaptureThumbnailProps {
  capture: CaptureCardCapture;
  isMissing: boolean;
  isMedia: boolean;
  isQuickVideo: boolean;
  isPlaceholder: boolean;
  hasThumbnail: boolean;
  thumbnailFit: ThumbnailFit;
  thumbnailSrc: string;
  thumbLoaded: boolean;
  thumbError: boolean;
  imgKey: number;
  selected: boolean;
  isActive?: boolean;
  isLoading?: boolean;
  onThumbLoaded: () => void;
  onThumbError: () => void;
  onToggleFavorite: () => void;
}

interface ThumbnailContentProps {
  capture: CaptureCardCapture;
  isMissing: boolean;
  isMedia: boolean;
  isPlaceholder: boolean;
  hasThumbnail: boolean;
  thumbnailFit: ThumbnailFit;
  thumbnailSrc: string;
  thumbLoaded: boolean;
  thumbError: boolean;
  imgKey: number;
  onThumbLoaded: () => void;
  onThumbError: () => void;
}

function ThumbnailContent({
  capture,
  isMissing,
  isMedia,
  isPlaceholder,
  hasThumbnail,
  thumbnailFit,
  thumbnailSrc,
  thumbLoaded,
  thumbError,
  imgKey,
  onThumbLoaded,
  onThumbError,
}: ThumbnailContentProps) {
  if (isPlaceholder) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--polar-mist)]">
        <Loader2 className="w-8 h-8 text-[var(--ink-subtle)] animate-spin" />
      </div>
    );
  }

  if (isMissing) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--polar-mist)] gap-2">
        <AlertTriangle className="w-8 h-8 text-amber-500" />
        <span className="text-xs text-[var(--ink-subtle)]">File missing</span>
      </div>
    );
  }

  if (isMedia && !hasThumbnail) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[var(--polar-mist)] to-[var(--polar-frost)] gap-2">
        {capture.capture_type === 'gif' ? (
          <Film className="w-12 h-12 text-purple-400" />
        ) : (
          <Video className="w-12 h-12 text-blue-400" />
        )}
        <span className="text-xs font-medium text-[var(--ink-subtle)] uppercase">
          {capture.capture_type}
        </span>
      </div>
    );
  }

  if (thumbError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--polar-mist)] gap-2">
        <AlertTriangle className="w-6 h-6 text-amber-400" />
        <span className="text-[10px] text-[var(--ink-subtle)]">
          Thumbnail unavailable
        </span>
      </div>
    );
  }

  return (
    <>
      {!thumbLoaded && (
        <div className="absolute inset-0 bg-[var(--polar-mist)] animate-pulse" />
      )}
      <img
        key={imgKey}
        src={thumbnailSrc}
        alt="Capture"
        onLoad={onThumbLoaded}
        onError={onThumbError}
        className={`thumbnail-image ${
          thumbnailFit === 'preserve'
            ? 'thumbnail-image--preserve'
            : 'thumbnail-image--cover'
        } transition-opacity duration-200 ${thumbLoaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </>
  );
}

function CaptureMediaBadges({
  capture,
  isMedia,
  isMissing,
  isQuickVideo,
}: Pick<CaptureThumbnailProps, 'capture' | 'isMedia' | 'isMissing' | 'isQuickVideo'>) {
  if (!isMedia || isMissing) {
    return null;
  }

  return (
    <div className="absolute bottom-3 left-3 flex items-center gap-2">
      <div className="px-2 py-1 rounded-md bg-black/70 text-white text-[10px] font-medium uppercase">
        {capture.capture_type}
      </div>
      {isQuickVideo && (
        <div className="px-2 py-1 rounded-md bg-[var(--accent-400)]/90 text-white text-[10px] font-medium">
          Quick Capture
        </div>
      )}
    </div>
  );
}

function CaptureSelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <div
      className={`absolute top-3 left-3 transition-all duration-200 ${
        selected
          ? 'opacity-100 scale-100'
          : 'opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100'
      }`}
    >
      <div className={`checkbox-custom ${selected ? 'checked' : ''}`}>
        {selected && <Check className="w-3 h-3" />}
      </div>
    </div>
  );
}

function FavoriteButton({
  favorite,
  onToggleFavorite,
}: {
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onToggleFavorite();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
      className={`absolute top-3 right-3 z-10 w-[26px] h-[26px] rounded-lg flex items-center justify-center border shadow-sm transition-all duration-200 hover:scale-110 ${
        favorite
          ? 'bg-[var(--card)] border-[var(--accent-200)] opacity-100'
          : 'bg-[var(--card)]/80 border-transparent opacity-0 group-hover:opacity-100'
      }`}
    >
      <Star
        className="w-3.5 h-3.5 text-[var(--accent-400)] transition-colors"
        fill={favorite ? 'currentColor' : 'none'}
      />
    </button>
  );
}

function CaptureThumbnail({
  capture,
  isMissing,
  isMedia,
  isQuickVideo,
  isPlaceholder,
  hasThumbnail,
  thumbnailFit,
  thumbnailSrc,
  thumbLoaded,
  thumbError,
  imgKey,
  selected,
  isActive,
  isLoading,
  onThumbLoaded,
  onThumbError,
  onToggleFavorite,
}: CaptureThumbnailProps) {
  return (
    <div
      className={`thumbnail ${isMissing ? 'opacity-60' : ''} ${
        thumbnailFit === 'preserve' ? 'thumbnail-surface--preserve' : ''
      }`}
    >
      <ThumbnailContent
        capture={capture}
        isMissing={isMissing}
        isMedia={isMedia}
        isPlaceholder={isPlaceholder}
        hasThumbnail={hasThumbnail}
        thumbnailFit={thumbnailFit}
        thumbnailSrc={thumbnailSrc}
        thumbLoaded={thumbLoaded}
        thumbError={thumbError}
        imgKey={imgKey}
        onThumbLoaded={onThumbLoaded}
        onThumbError={onThumbError}
      />

      <CaptureMediaBadges
        capture={capture}
        isMedia={isMedia}
        isMissing={isMissing}
        isQuickVideo={isQuickVideo}
      />

      <CaptureSelectionIndicator selected={selected} />

      <FavoriteButton
        favorite={capture.favorite}
        onToggleFavorite={onToggleFavorite}
      />

      {isActive && (
        <div
          className="capture-card__active-eye"
          aria-label="Currently open media"
          title="Currently open media"
        >
          <Eye className="w-3.5 h-3.5" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      {capture.damaged && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded">
          <AlertTriangle className="w-8 h-8 text-yellow-400" />
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 bg-[var(--polar-snow)]/95 flex items-center justify-center z-10 animate-fade-in">
          <Loader2 className="w-6 h-6 text-[var(--accent-400)] animate-spin" />
        </div>
      )}
    </div>
  );
}

interface CaptureCardFooterProps {
  capture: CaptureCardCapture;
  allTags: string[];
  isPlaceholder: boolean;
  isQuickVideo: boolean;
  dimensionsLabel: string;
  captureTypeLabel: string;
  tagPopoverOpen: boolean;
  formatDate: (date: string) => string;
  onTagPopoverOpenChange: (open: boolean) => void;
  onUpdateTags: (tags: string[]) => void;
  onDelete: () => void;
}

function CaptureCardFooter({
  capture,
  allTags,
  isPlaceholder,
  isQuickVideo,
  dimensionsLabel,
  captureTypeLabel,
  tagPopoverOpen,
  formatDate,
  onTagPopoverOpenChange,
  onUpdateTags,
  onDelete,
}: CaptureCardFooterProps) {
  return (
    <div className="card-footer flex items-center justify-between">
      <Popover>
        <PopoverTrigger asChild>
          <button
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            aria-label="Capture info"
            className="capture-card__icon-button"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          className="capture-info-popover"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="capture-info-popover__title">Capture details</div>
          <div className="capture-info-popover__rows">
            <div>
              <span>Created</span>
              <strong>{isPlaceholder ? 'Saving...' : formatDate(capture.created_at)}</strong>
            </div>
            <div>
              <span>Dimensions</span>
              <strong>{dimensionsLabel}</strong>
            </div>
            <div>
              <span>Type</span>
              <strong>{captureTypeLabel}</strong>
            </div>
            {isQuickVideo && (
              <div>
                <span>Status</span>
                <strong>Ready to share</strong>
              </div>
            )}
          </div>
          {!isPlaceholder && capture.tags.length > 0 && (
            <div className="capture-info-popover__tags">
              {capture.tags.map((tag) => (
                <TagChip key={tag} tag={tag} size="sm" />
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {!isPlaceholder && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <TagPopover
            currentTags={capture.tags}
            allTags={allTags}
            onTagsChange={onUpdateTags}
            open={tagPopoverOpen}
            onOpenChange={onTagPopoverOpenChange}
            trigger={
              <button
                onClick={(event) => event.stopPropagation()}
                aria-label="Manage tags"
                className="capture-card__icon-button"
              >
                <Tag
                  className="w-3.5 h-3.5 transition-colors"
                  style={{
                    color:
                      capture.tags.length > 0
                        ? 'var(--accent-400)'
                        : 'var(--ink-subtle)',
                  }}
                />
              </button>
            }
          />
          <button
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label="Delete capture"
            className="capture-card__icon-button capture-card__icon-button--danger"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export const CaptureCard: React.FC<CaptureCardProps> = memo(
  ({
    capture,
    selected,
    isActive,
    isLoading,
    allTags,
    onSelect,
    onOpen,
    onToggleFavorite,
    onUpdateTags,
    onDelete,
    onOpenInFolder,
    onCopyToClipboard,
    onPlayMedia,
    onEditVideo,
    onSaveCopy,
    onRepair,
    formatDate,
  }) => {
    const [thumbLoaded, setThumbLoaded] = useState(false);
    const [thumbError, setThumbError] = useState(false);
    const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
    const { ref, isVisible } = useInViewAnimation();

    // Check if this is a placeholder (optimistic update, saving in progress)
    const isPlaceholder = capture.id.startsWith('temp_');
    const isMissing = capture.is_missing;
    const isMedia = isVideoOrGif(capture.capture_type);
    const isQuickVideo = capture.capture_type === 'video' && Boolean(capture.quick_capture);
    const hasThumbnail = capture.thumbnail_path && capture.thumbnail_path.length > 0;
    const thumbnailFit = getCaptureCardThumbnailFit(capture);
    const captureTypeLabel = capture.capture_type.toUpperCase();
    const dimensionsLabel = isPlaceholder
      ? '-- x --'
      : isMedia && capture.dimensions.width === 0
        ? captureTypeLabel
        : `${capture.dimensions.width} x ${capture.dimensions.height}`;

    // Use cached URL to avoid repeated convertFileSrc calls
    const thumbnailSrc = useMemo(() => {
      if (isPlaceholder || isMissing || !hasThumbnail) return '';
      return getCachedThumbnailUrl(capture.thumbnail_path);
    }, [capture.thumbnail_path, isPlaceholder, isMissing, hasThumbnail]);

    // Key to force img remount when needed (fixes Activity visibility issue)
    const [imgKey, setImgKey] = useState(0);
    const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Reset load state when thumbnail path changes
    useEffect(() => {
      setThumbLoaded(false);
      setThumbError(false);
      setImgKey(k => k + 1); // Force new img element
    }, [capture.thumbnail_path]);

    // Detect stale img that never loaded (Activity visibility issue)
    useEffect(() => {
      if (thumbnailSrc && !thumbLoaded && !thumbError) {
        // If image hasn't loaded after 500ms, force a remount
        loadTimeoutRef.current = setTimeout(() => {
          if (!thumbLoaded && !thumbError) {
            setImgKey(k => k + 1);
          }
        }, 500);
      }
      return () => {
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current);
        }
      };
    }, [thumbnailSrc, thumbLoaded, thumbError, imgKey]);

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={ref}
            className={`capture-card group ${selected ? 'selected' : ''} ${isActive ? 'is-active-media' : ''} ${isVisible ? 'in-view' : ''}`}
            data-capture-id={capture.id}
            data-active-media={isActive ? 'true' : undefined}
            onClick={(e) => onSelect(capture.id, e)}
            onDoubleClick={() => {
              if (capture.damaged) {
                onRepair?.();
                return;
              }
              onOpen(capture.id);
            }}
            onContextMenu={(e) => {
              // Select on right-click if not already selected
              if (!selected) {
                onSelect(capture.id, e);
              }
            }}
          >
            <CaptureThumbnail
              capture={capture}
              isMissing={isMissing}
              isMedia={isMedia}
              isQuickVideo={isQuickVideo}
              isPlaceholder={isPlaceholder}
              hasThumbnail={Boolean(hasThumbnail)}
              thumbnailFit={thumbnailFit}
              thumbnailSrc={thumbnailSrc}
              thumbLoaded={thumbLoaded}
              thumbError={thumbError}
              imgKey={imgKey}
              selected={selected}
              isActive={isActive}
              isLoading={isLoading}
              onThumbLoaded={() => setThumbLoaded(true)}
              onThumbError={() => setThumbError(true)}
              onToggleFavorite={onToggleFavorite}
            />

            <CaptureCardFooter
              capture={capture}
              allTags={allTags}
              isPlaceholder={isPlaceholder}
              isQuickVideo={isQuickVideo}
              dimensionsLabel={dimensionsLabel}
              captureTypeLabel={captureTypeLabel}
              tagPopoverOpen={tagPopoverOpen}
              formatDate={formatDate}
              onTagPopoverOpenChange={setTagPopoverOpen}
              onUpdateTags={onUpdateTags}
              onDelete={onDelete}
            />
          </div>
        </ContextMenuTrigger>
        <CaptureContextMenu
          favorite={capture.favorite}
          isMissing={isMissing}
          captureType={capture.capture_type}
          quickCapture={capture.quick_capture}
          onCopyToClipboard={onCopyToClipboard}
          onOpenInFolder={onOpenInFolder}
          onToggleFavorite={onToggleFavorite}
          onManageTags={() => setTagPopoverOpen(true)}
          onDelete={onDelete}
          onPlayMedia={onPlayMedia}
          onEditVideo={onEditVideo}
          onSaveCopy={onSaveCopy}
          damaged={capture.damaged}
          onRepair={onRepair}
        />
      </ContextMenu>
    );
  },
  capturePropsAreEqual
);
