import React, { memo, useState, useMemo, useEffect, useRef } from 'react';
import { Star, Trash2, Check, AlertTriangle, Loader2, Video, Film, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { CaptureContextMenu } from './CaptureContextMenu';
import { TagChip } from './TagChip';
import { TagPopover } from './TagPopover';
import { useInViewAnimation, getCachedThumbnailUrl } from '../hooks';
import type { CaptureCardProps } from './types';
import { capturePropsAreEqual } from './types';

// Check if capture is a video or gif recording
const isVideoOrGif = (captureType: string) => captureType === 'video' || captureType === 'gif';
const MAX_VISIBLE_ROW_TAGS = 4;

type CaptureRowCapture = CaptureCardProps['capture'];

interface CaptureRowThumbnailProps {
  capture: CaptureRowCapture;
  isMissing: boolean;
  isMedia: boolean;
  isPlaceholder: boolean;
  hasThumbnail: boolean;
  thumbnailSrc: string;
  thumbLoaded: boolean;
  thumbError: boolean;
  imgKey: number;
  isLoading?: boolean;
  onThumbLoaded: () => void;
  onThumbError: () => void;
}

function CaptureRowStatusThumbnail({ variant }: { variant: 'missing' | 'error' | 'placeholder' }) {
  if (variant === 'placeholder') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--polar-mist)]">
        <Loader2 className="w-5 h-5 text-[var(--ink-subtle)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-[var(--polar-mist)]">
      <AlertTriangle className={`w-5 h-5 ${variant === 'missing' ? 'text-amber-500' : 'text-amber-400'}`} />
    </div>
  );
}

function CaptureRowMediaFallback({ captureType }: { captureType: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[var(--polar-mist)] to-[var(--polar-frost)]">
      {captureType === 'gif' ? (
        <Film className="w-6 h-6 text-purple-400" />
      ) : (
        <Video className="w-6 h-6 text-blue-400" />
      )}
    </div>
  );
}

function CaptureRowImageThumbnail({
  thumbnailSrc,
  thumbLoaded,
  imgKey,
  onThumbLoaded,
  onThumbError,
}: {
  thumbnailSrc: string;
  thumbLoaded: boolean;
  imgKey: number;
  onThumbLoaded: () => void;
  onThumbError: () => void;
}) {
  return (
    <>
      {!thumbLoaded && (
        <div className="absolute inset-0 bg-[var(--polar-mist)] animate-pulse rounded" />
      )}
      <img
        key={imgKey}
        src={thumbnailSrc}
        alt="Capture"
        onLoad={onThumbLoaded}
        onError={onThumbError}
        className={`transition-opacity duration-200 ${thumbLoaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </>
  );
}

function getCaptureRowThumbnailVariant({
  isMissing,
  isMedia,
  isPlaceholder,
  hasThumbnail,
  thumbError,
}: {
  isMissing: boolean;
  isMedia: boolean;
  isPlaceholder: boolean;
  hasThumbnail: boolean;
  thumbError: boolean;
}) {
  return [
    { when: isMissing, variant: 'missing' },
    { when: isMedia && !hasThumbnail, variant: 'media' },
    { when: isPlaceholder, variant: 'placeholder' },
    { when: thumbError, variant: 'error' },
  ].find(({ when }) => when)?.variant ?? 'image';
}

type CaptureRowThumbnailVariant = ReturnType<typeof getCaptureRowThumbnailVariant>;

function renderCaptureRowThumbnailVariant({
  thumbnailVariant,
  capture,
  thumbnailSrc,
  thumbLoaded,
  imgKey,
  onThumbLoaded,
  onThumbError,
}: {
  thumbnailVariant: CaptureRowThumbnailVariant;
  capture: CaptureRowCapture;
  thumbnailSrc: string;
  thumbLoaded: boolean;
  imgKey: number;
  onThumbLoaded: () => void;
  onThumbError: () => void;
}) {
  const renderers: Record<CaptureRowThumbnailVariant, () => React.ReactNode> = {
    missing: () => <CaptureRowStatusThumbnail variant="missing" />,
    media: () => <CaptureRowMediaFallback captureType={capture.capture_type} />,
    placeholder: () => <CaptureRowStatusThumbnail variant="placeholder" />,
    error: () => <CaptureRowStatusThumbnail variant="error" />,
    image: () => (
      <CaptureRowImageThumbnail
        thumbnailSrc={thumbnailSrc}
        thumbLoaded={thumbLoaded}
        imgKey={imgKey}
        onThumbLoaded={onThumbLoaded}
        onThumbError={onThumbError}
      />
    ),
  };

  return renderers[thumbnailVariant]();
}

function CaptureRowThumbnailContent({
  capture,
  isMissing,
  isMedia,
  isPlaceholder,
  hasThumbnail,
  thumbnailSrc,
  thumbLoaded,
  thumbError,
  imgKey,
  onThumbLoaded,
  onThumbError,
}: Omit<CaptureRowThumbnailProps, 'isLoading'>) {
  const thumbnailVariant = getCaptureRowThumbnailVariant({
    isMissing,
    isMedia,
    isPlaceholder,
    hasThumbnail,
    thumbError,
  });

  return renderCaptureRowThumbnailVariant({
    thumbnailVariant,
    capture,
    thumbnailSrc,
    thumbLoaded,
    imgKey,
    onThumbLoaded,
    onThumbError,
  });
}
function CaptureRowThumbnail({
  capture,
  isMissing,
  isMedia,
  isPlaceholder,
  hasThumbnail,
  thumbnailSrc,
  thumbLoaded,
  thumbError,
  imgKey,
  isLoading,
  onThumbLoaded,
  onThumbError,
}: CaptureRowThumbnailProps) {
  return (
    <div className={`row-thumbnail relative ${isMissing ? 'opacity-60' : ''}`}>
      <CaptureRowThumbnailContent
        capture={capture}
        isMissing={isMissing}
        isMedia={isMedia}
        isPlaceholder={isPlaceholder}
        hasThumbnail={hasThumbnail}
        thumbnailSrc={thumbnailSrc}
        thumbLoaded={thumbLoaded}
        thumbError={thumbError}
        imgKey={imgKey}
        onThumbLoaded={onThumbLoaded}
        onThumbError={onThumbError}
      />
      {isLoading && (
        <div className="absolute inset-0 bg-[var(--card)]/95 flex items-center justify-center rounded animate-fade-in">
          <Loader2 className="w-4 h-4 text-[var(--accent-400)] animate-spin" />
        </div>
      )}
    </div>
  );
}

interface CaptureRowInfoProps {
  capture: CaptureRowCapture;
  isMissing: boolean;
  isMedia: boolean;
  isQuickVideo: boolean;
  formatDate: (date: string) => string;
}

function getCaptureSizeLabel(capture: CaptureRowCapture, isMedia: boolean): string {
  if (isMedia && capture.dimensions.width === 0) {
    return capture.capture_type.toUpperCase();
  }

  return `${capture.dimensions.width} × ${capture.dimensions.height}`;
}

interface CaptureRowBadgeItem {
  key: string;
  label: string;
  className: string;
}

function getCaptureRowBadgeItems({
  capture,
  isMissing,
  isQuickVideo,
}: Pick<CaptureRowInfoProps, 'capture' | 'isMissing' | 'isQuickVideo'>): CaptureRowBadgeItem[] {
  return [
    {
      show: isMissing,
      badge: { key: 'missing', label: 'Missing', className: 'bg-amber-100 text-amber-700' },
    },
    {
      show: isQuickVideo && !isMissing,
      badge: { key: 'quick', label: 'Quick Capture', className: 'pill-accent' },
    },
    {
      show: capture.has_annotations && !isMissing,
      badge: { key: 'edited', label: 'Edited', className: 'pill-accent' },
    },
  ]
    .filter(({ show }) => show)
    .map(({ badge }) => badge);
}

function CaptureRowBadges({
  capture,
  isMissing,
  isQuickVideo,
}: Pick<CaptureRowInfoProps, 'capture' | 'isMissing' | 'isQuickVideo'>) {
  return (
    <>
      {getCaptureRowBadgeItems({ capture, isMissing, isQuickVideo }).map((badge) => (
        <Badge key={badge.key} className={`${badge.className} text-[10px] px-2 py-0.5`}>
          {badge.label}
        </Badge>
      ))}
    </>
  );
}

function CaptureRowTags({ tags }: { tags: string[] }) {
  const hiddenTagCount = tags.length - MAX_VISIBLE_ROW_TAGS;

  return (
    <>
      {tags.slice(0, MAX_VISIBLE_ROW_TAGS).map((tag) => (
        <TagChip key={tag} tag={tag} size="sm" />
      ))}
      {hiddenTagCount > 0 && (
        <span className="text-[10px] text-[var(--ink-muted)]">
          +{hiddenTagCount}
        </span>
      )}
    </>
  );
}

function CaptureRowMetadata({
  capture,
  isMedia,
  isQuickVideo,
  formatDate,
}: Pick<CaptureRowInfoProps, 'capture' | 'isMedia' | 'isQuickVideo' | 'formatDate'>) {
  return (
    <div className="text-xs text-[var(--ink-subtle)] font-mono">
      {getCaptureSizeLabel(capture, isMedia)}
      <span className="mx-2 text-[var(--polar-frost)]">·</span>
      {formatDate(capture.created_at)}
      {isQuickVideo && (
        <>
          <span className="mx-2 text-[var(--polar-frost)]">·</span>
          <span className="text-[var(--accent-400)]">Ready to share</span>
        </>
      )}
    </div>
  );
}

function CaptureRowInfo(props: CaptureRowInfoProps) {
  const { capture, isMissing } = props;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-sm font-medium capitalize ${isMissing ? 'text-[var(--ink-subtle)]' : 'text-[var(--ink-black)]'}`}>
          {capture.capture_type} capture
        </span>
        <CaptureRowBadges
          capture={capture}
          isMissing={isMissing}
          isQuickVideo={props.isQuickVideo}
        />
        <CaptureRowTags tags={capture.tags} />
      </div>
      <CaptureRowMetadata
        capture={capture}
        isMedia={props.isMedia}
        isQuickVideo={props.isQuickVideo}
        formatDate={props.formatDate}
      />
    </div>
  );
}

interface CaptureRowActionsProps {
  capture: CaptureRowCapture;
  allTags: string[];
  tagPopoverOpen: boolean;
  onTagPopoverOpenChange: (open: boolean) => void;
  onUpdateTags: (tags: string[]) => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}

function getActionAccentColor(active: boolean) {
  return active ? 'var(--accent-400)' : 'var(--ink-subtle)';
}

function getFavoriteActionLabel(favorite: boolean) {
  return favorite ? 'Remove from favorites' : 'Add to favorites';
}

function stopRowAction(event: React.MouseEvent<HTMLButtonElement>, action?: () => void) {
  event.stopPropagation();
  action?.();
}

function CaptureRowTooltipButton({
  label,
  ariaLabel = label,
  className,
  onClick,
  children,
}: {
  label: string;
  ariaLabel?: string;
  className: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} aria-label={ariaLabel} className={className}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function CaptureRowTagTrigger({ hasTags }: { hasTags: boolean }) {
  return (
    <CaptureRowTooltipButton
      label="Manage tags"
      ariaLabel="Manage tags"
      onClick={(event) => stopRowAction(event)}
      className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--polar-mist)] transition-colors"
    >
      <Tag className="w-4 h-4" style={{ color: getActionAccentColor(hasTags) }} />
    </CaptureRowTooltipButton>
  );
}

function CaptureRowActions({
  capture,
  allTags,
  tagPopoverOpen,
  onTagPopoverOpenChange,
  onUpdateTags,
  onToggleFavorite,
  onDelete,
}: CaptureRowActionsProps) {
  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <TagPopover
        currentTags={capture.tags}
        allTags={allTags}
        onTagsChange={onUpdateTags}
        open={tagPopoverOpen}
        onOpenChange={onTagPopoverOpenChange}
        trigger={<CaptureRowTagTrigger hasTags={capture.tags.length > 0} />}
      />
      <CaptureRowTooltipButton
        label={getFavoriteActionLabel(capture.favorite)}
        onClick={(event) => stopRowAction(event, onToggleFavorite)}
        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--polar-mist)] transition-colors"
      >
        <Star
          className="w-4 h-4"
          fill={capture.favorite ? 'currentColor' : 'none'}
          style={{ color: getActionAccentColor(capture.favorite) }}
        />
      </CaptureRowTooltipButton>
      <CaptureRowTooltipButton
        label="Delete capture"
        onClick={(event) => stopRowAction(event, onDelete)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </CaptureRowTooltipButton>
    </div>
  );
}

function useCaptureRowThumbnail({
  capture,
  isPlaceholder,
  isMissing,
  hasThumbnail,
}: {
  capture: CaptureRowCapture;
  isPlaceholder: boolean;
  isMissing: boolean;
  hasThumbnail: boolean;
}) {
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const [imgKey, setImgKey] = useState(0);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const thumbnailSrc = useMemo(() => {
    if (isPlaceholder || isMissing || !hasThumbnail) return '';
    return getCachedThumbnailUrl(capture.thumbnail_path);
  }, [capture.thumbnail_path, isPlaceholder, isMissing, hasThumbnail]);

  useEffect(() => {
    setThumbLoaded(false);
    setThumbError(false);
    setImgKey((key) => key + 1);
  }, [capture.thumbnail_path]);

  useEffect(() => {
    if (thumbnailSrc && !thumbLoaded && !thumbError) {
      loadTimeoutRef.current = setTimeout(() => {
        if (!thumbLoaded && !thumbError) {
          setImgKey((key) => key + 1);
        }
      }, 500);
    }
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, [thumbnailSrc, thumbLoaded, thumbError, imgKey]);

  return {
    thumbnailSrc,
    thumbLoaded,
    thumbError,
    imgKey,
    setThumbLoaded,
    setThumbError,
  };
}

function getCaptureRowState(capture: CaptureRowCapture) {
  const isPlaceholder = capture.id.startsWith('temp_');
  const isMissing = capture.is_missing;
  const isMedia = isVideoOrGif(capture.capture_type);
  const isQuickVideo = capture.capture_type === 'video' && Boolean(capture.quick_capture);
  const hasThumbnail = Boolean(capture.thumbnail_path && capture.thumbnail_path.length > 0);

  return { isPlaceholder, isMissing, isMedia, isQuickVideo, hasThumbnail };
}

function getCaptureRowClassName(selected: boolean, isVisible: boolean): string {
  return `capture-row group ${selected ? 'selected' : ''} ${isVisible ? 'in-view' : ''}`;
}

function CaptureRowCheckbox({ selected }: { selected: boolean }) {
  return (
    <div className={`checkbox-custom ${selected ? 'checked' : ''}`}>
      {selected && <Check className="w-3 h-3" />}
    </div>
  );
}

export const CaptureRow: React.FC<CaptureCardProps> = memo(
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
    formatDate,
  }) => {
    const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
    const { ref, isVisible } = useInViewAnimation();
    const { isPlaceholder, isMissing, isMedia, isQuickVideo, hasThumbnail } =
      getCaptureRowState(capture);
    const {
      thumbnailSrc,
      thumbLoaded,
      thumbError,
      imgKey,
      setThumbLoaded,
      setThumbError,
    } = useCaptureRowThumbnail({ capture, isPlaceholder, isMissing, hasThumbnail });
    const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
      if (!selected) {
        onSelect(capture.id, event);
      }
    };

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={ref}
            className={getCaptureRowClassName(selected, isVisible)}
            data-capture-id={capture.id}
            onClick={(e) => onSelect(capture.id, e)}
            onDoubleClick={() => onOpen(capture.id)}
            onContextMenu={handleContextMenu}
          >
            <CaptureRowCheckbox selected={selected} />

            <CaptureRowThumbnail
              capture={capture}
              isMissing={isMissing}
              isMedia={isMedia}
              isPlaceholder={isPlaceholder}
              hasThumbnail={hasThumbnail}
              thumbnailSrc={thumbnailSrc}
              thumbLoaded={thumbLoaded}
              thumbError={thumbError}
              imgKey={imgKey}
              isLoading={isLoading}
              onThumbLoaded={() => setThumbLoaded(true)}
              onThumbError={() => setThumbError(true)}
            />

            <CaptureRowInfo
              capture={capture}
              isMissing={isMissing}
              isMedia={isMedia}
              isQuickVideo={isQuickVideo}
              formatDate={formatDate}
            />

            <CaptureRowActions
              capture={capture}
              allTags={allTags}
              tagPopoverOpen={tagPopoverOpen}
              onTagPopoverOpenChange={setTagPopoverOpen}
              onUpdateTags={onUpdateTags}
              onToggleFavorite={onToggleFavorite}
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
        />
      </ContextMenu>
    );
  },
  capturePropsAreEqual
);
