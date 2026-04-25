import React, { memo, useState, useMemo, useEffect, useRef } from 'react';
import { Star, Trash2, Check, Loader2, AlertTriangle, Video, Film, Tag, Info } from 'lucide-react';
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

export const CaptureCard: React.FC<CaptureCardProps> = memo(
  ({
    capture,
    selected,
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
            className={`capture-card group ${selected ? 'selected' : ''} ${isVisible ? 'in-view' : ''}`}
            data-capture-id={capture.id}
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
            {/* Thumbnail */}
            <div
              className={`thumbnail ${isMissing ? 'opacity-60' : ''} ${
                thumbnailFit === 'preserve' ? 'thumbnail-surface--preserve' : ''
              }`}
            >
              {isPlaceholder ? (
                <div className="w-full h-full flex items-center justify-center bg-[var(--polar-mist)]">
                  <Loader2 className="w-8 h-8 text-[var(--ink-subtle)] animate-spin" />
                </div>
              ) : isMissing ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--polar-mist)] gap-2">
                  <AlertTriangle className="w-8 h-8 text-amber-500" />
                  <span className="text-xs text-[var(--ink-subtle)]">File missing</span>
                </div>
              ) : isMedia && !hasThumbnail ? (
                // Video/GIF without thumbnail - show icon placeholder
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
              ) : thumbError ? (
                // Thumbnail failed to load - show error state
                <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--polar-mist)] gap-2">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                  <span className="text-[10px] text-[var(--ink-subtle)]">Thumbnail unavailable</span>
                </div>
              ) : (
                <>
                  {/* Skeleton placeholder until image loads */}
                  {!thumbLoaded && (
                    <div className="absolute inset-0 bg-[var(--polar-mist)] animate-pulse" />
                  )}
                  <img
                    key={imgKey}
                    src={thumbnailSrc}
                    alt="Capture"
                    onLoad={() => setThumbLoaded(true)}
                    onError={() => setThumbError(true)}
                    className={`thumbnail-image ${
                      thumbnailFit === 'preserve'
                        ? 'thumbnail-image--preserve'
                        : 'thumbnail-image--cover'
                    } transition-opacity duration-200 ${thumbLoaded ? 'opacity-100' : 'opacity-0'}`}
                  />
                </>
              )}
              
              {/* Media type badge for videos/gifs */}
              {isMedia && !isMissing && (
                <div className="absolute bottom-3 left-3 flex items-center gap-2">
                  <div className="px-2 py-1 rounded-md bg-black/70 text-white text-[10px] font-medium uppercase">
                    {capture.capture_type}
                  </div>
                  {isQuickVideo && (
                    <div className="px-2 py-1 rounded-md bg-[var(--coral-400)]/90 text-white text-[10px] font-medium">
                      Quick Capture
                    </div>
                  )}
                </div>
              )}

              {/* Selection Checkbox */}
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

              {/* Favorite Toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                aria-label={capture.favorite ? 'Remove from favorites' : 'Add to favorites'}
                className={`absolute top-3 right-3 z-10 w-7 h-7 rounded-lg flex items-center justify-center border shadow-sm transition-all duration-200 hover:scale-110 ${
                  capture.favorite
                    ? 'bg-[var(--card)] border-[var(--coral-200)] opacity-100'
                    : 'bg-[var(--card)]/80 border-transparent opacity-0 group-hover:opacity-100'
                }`}
              >
                <Star
                  className="w-3.5 h-3.5 text-[var(--coral-400)] transition-colors"
                  fill={capture.favorite ? 'currentColor' : 'none'}
                />
              </button>

              {/* Hover Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

              {/* Damaged Bundle Overlay */}
              {capture.damaged && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded">
                  <AlertTriangle className="w-8 h-8 text-yellow-400" />
                </div>
              )}

              {/* Loading Overlay - shown when opening this capture */}
              {isLoading && (
                <div className="absolute inset-0 bg-[var(--polar-snow)]/95 flex items-center justify-center z-10 animate-fade-in">
                  <Loader2 className="w-6 h-6 text-[var(--coral-400)] animate-spin" />
                </div>
              )}
            </div>

            {/* Card Actions */}
            <div className="card-footer flex items-center justify-between">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
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
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
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
                      {capture.tags.map(tag => (
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
                    onOpenChange={setTagPopoverOpen}
                    trigger={
                      <button
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Manage tags"
                        className="capture-card__icon-button"
                      >
                        <Tag
                          className="w-3.5 h-3.5 transition-colors"
                          style={{
                            color: capture.tags.length > 0 ? 'var(--coral-400)' : 'var(--ink-subtle)',
                          }}
                        />
                      </button>
                    }
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
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
