/**
 * useSceneMode - Gets interpolated scene state at the current timestamp.
 *
 * Ports Cap's scene interpolation logic for smooth transitions between modes.
 * Uses bezier easing for natural-feeling transitions.
 *
 * Scene modes control what is displayed:
 * - default: Screen with webcam overlay
 * - cameraOnly: Fullscreen webcam (blur/fade screen)
 * - screenOnly: Screen only (hide webcam)
 */

import { useMemo } from 'react';
import type { SceneSegment, SceneMode } from '../types';

/** Scene transition duration in seconds (matches Cap) */
const SCENE_TRANSITION_DURATION = 0.3;
/** Minimum gap to trigger a transition through default mode */
const MIN_GAP_FOR_TRANSITION = 0.5;
const BEZIER_SOLVE_EPSILON = 1e-6;
const BEZIER_NEWTON_ITERATIONS = 8;
const BEZIER_BISECTION_ITERATIONS = 20;

// ============================================================================
// Bezier Easing - Proper cubic bezier implementation
// ============================================================================

type CurveSampler = (t: number) => number;

function solveCurveXWithNewton(
  x: number,
  sampleCurveX: CurveSampler,
  sampleCurveDerivativeX: CurveSampler
): number | null {
  let t = x;
  for (let i = 0; i < BEZIER_NEWTON_ITERATIONS; i++) {
    const xEstimate = sampleCurveX(t) - x;
    if (Math.abs(xEstimate) < BEZIER_SOLVE_EPSILON) return t;

    const derivative = sampleCurveDerivativeX(t);
    if (Math.abs(derivative) < BEZIER_SOLVE_EPSILON) return null;

    t -= xEstimate / derivative;
  }

  return null;
}

function solveCurveXWithBisection(x: number, sampleCurveX: CurveSampler): number {
  let lo = 0;
  let hi = 1;
  let t = x;

  for (let i = 0; i < BEZIER_BISECTION_ITERATIONS; i++) {
    const xEstimate = sampleCurveX(t);
    if (Math.abs(xEstimate - x) < BEZIER_SOLVE_EPSILON) return t;

    if (x > xEstimate) {
      lo = t;
    } else {
      hi = t;
    }
    t = (lo + hi) / 2;
  }

  return t;
}

/**
 * Attempt to solve the cubic bezier curve for a given t value.
 * Uses Newton-Raphson iteration for accuracy (same approach as bezier-easing crate).
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const sampleCurveX = (t: number): number => {
    return ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t;
  };
  
  const sampleCurveY = (t: number): number => {
    return ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t;
  };
  
  const sampleCurveDerivativeX = (t: number): number => {
    return (3 * (1 - 3 * x2 + 3 * x1) * t + 2 * (3 * x2 - 6 * x1)) * t + 3 * x1;
  };
   
  const solveCurveX = (x: number): number => {
    return (
      solveCurveXWithNewton(x, sampleCurveX, sampleCurveDerivativeX) ??
      solveCurveXWithBisection(x, sampleCurveX)
    );
  };
  
  return (x: number): number => {
    if (x === 0 || x === 1) return x;
    return sampleCurveY(solveCurveX(x));
  };
}

// CSS ease-in-out: cubic-bezier(0.42, 0, 0.58, 1)
const easeInOutCurve = cubicBezier(0.42, 0.0, 0.58, 1.0);

/**
 * CSS ease-in-out bezier curve: cubic-bezier(0.42, 0, 0.58, 1)
 */
function easeInOut(t: number): number {
  return easeInOutCurve(t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ============================================================================
// Scene Cursor (tracks position in scene timeline)
// ============================================================================

interface SceneSegmentsCursor {
  timeS: number;
  segment: SceneSegment | null;
  prevSegment: SceneSegment | null;
  segments: SceneSegment[];
}

function areSceneSegmentsSorted(segments: SceneSegment[]): boolean {
  return segments.every((segment, index) => index === 0 || segments[index - 1].startMs <= segment.startMs);
}

function sortSceneSegmentsByStart(segments: SceneSegment[]): SceneSegment[] {
  return segments.length < 2 || areSceneSegmentsSorted(segments)
    ? segments
    : [...segments].sort((a, b) => a.startMs - b.startMs);
}

function findLastSegmentStartingAtOrBefore(segments: SceneSegment[], timeMs: number): number {
  let low = 0;
  let high = segments.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].startMs <= timeMs) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function findFirstSegmentStartingAfter(segments: SceneSegment[], timeMs: number): number {
  let low = 0;
  let high = segments.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].startMs > timeMs) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

interface SceneCursorCandidate {
  idx: number;
  segment: SceneSegment | null;
}

function getSceneCursorCandidate(segments: SceneSegment[], timeMs: number): SceneCursorCandidate {
  const idx = findLastSegmentStartingAtOrBefore(segments, timeMs);
  return {
    idx,
    segment: idx >= 0 ? segments[idx] : null,
  };
}

function getPreviousSceneCursorSegment(
  segments: SceneSegment[],
  candidate: SceneCursorCandidate
): SceneSegment | null {
  return candidate.idx > 0 ? segments[candidate.idx - 1] : null;
}

function isSceneCursorCandidateActive(
  candidate: SceneCursorCandidate,
  timeMs: number
): candidate is SceneCursorCandidate & { segment: SceneSegment } {
  return candidate.segment !== null && timeMs < candidate.segment.endMs;
}

function createSceneCursor(timeS: number, segments: SceneSegment[]): SceneSegmentsCursor {
  const timeMs = timeS * 1000;
  const candidate = getSceneCursorCandidate(segments, timeMs);

  if (isSceneCursorCandidateActive(candidate, timeMs)) {
    return {
      timeS,
      segment: candidate.segment,
      prevSegment: getPreviousSceneCursorSegment(segments, candidate),
      segments,
    };
  }

  return {
    timeS,
    segment: null,
    prevSegment: candidate.segment,
    segments,
  };
}

function getNextSegment(cursor: SceneSegmentsCursor): SceneSegment | null {
  const timeMs = cursor.timeS * 1000;
  const idx = findFirstSegmentStartingAfter(cursor.segments, timeMs);
  return idx >= 0 ? cursor.segments[idx] : null;
}

// ============================================================================
// Interpolated Scene (Cap's approach)
// ============================================================================

export interface InterpolatedScene {
  /** Webcam opacity (0-1) */
  cameraOpacity: number;
  /** Screen opacity (0-1) */
  screenOpacity: number;
  /** Webcam scale factor */
  cameraScale: number;
  /** Current scene mode (for discrete decisions) */
  sceneMode: SceneMode;
  /** Transition progress (0-1) */
  transitionProgress: number;
  /** Mode transitioning from */
  fromMode: SceneMode;
  /** Mode transitioning to */
  toMode: SceneMode;
  /** Screen blur amount (0-1) for camera-only transitions */
  screenBlur: number;
  /** Camera zoom during camera-only transition */
  cameraOnlyZoom: number;
  /** Camera blur during camera-only transition */
  cameraOnlyBlur: number;
}

function getSceneValues(mode: SceneMode): { cameraOpacity: number; screenOpacity: number; cameraScale: number } {
  switch (mode) {
    case 'default':
      return { cameraOpacity: 1, screenOpacity: 1, cameraScale: 1 };
    case 'cameraOnly':
      return { cameraOpacity: 1, screenOpacity: 1, cameraScale: 1 };
    case 'screenOnly':
      return { cameraOpacity: 0, screenOpacity: 1, cameraScale: 1 };
    default:
      return { cameraOpacity: 1, screenOpacity: 1, cameraScale: 1 };
  }
}

function fromSingleMode(mode: SceneMode): InterpolatedScene {
  const values = getSceneValues(mode);
  return {
    cameraOpacity: values.cameraOpacity,
    screenOpacity: values.screenOpacity,
    cameraScale: values.cameraScale,
    sceneMode: mode,
    transitionProgress: 1,
    fromMode: mode,
    toMode: mode,
    screenBlur: 0,
    cameraOnlyZoom: 1,
    cameraOnlyBlur: 0,
  };
}

function isSameMode(a: SceneMode, b: SceneMode): boolean {
  return a === b;
}

interface SceneTransition {
  currentMode: SceneMode;
  nextMode: SceneMode;
  transitionProgress: number;
}

function createSceneTransition(
  currentMode: SceneMode,
  nextMode: SceneMode,
  transitionProgress = 1
): SceneTransition {
  return { currentMode, nextMode, transitionProgress };
}

function easeTransitionProgress(progress: number): number {
  return easeInOut(Math.min(1, Math.max(0, progress)));
}

function getSegmentGapSeconds(startMs: number, endMs: number): number {
  return startMs / 1000 - endMs / 1000;
}

function shouldHoldModeAcrossGap(
  currentMode: SceneMode,
  adjacentMode: SceneMode,
  gapSeconds: number
): boolean {
  return gapSeconds < MIN_GAP_FOR_TRANSITION && isSameMode(currentMode, adjacentMode);
}

function getModeAcrossGap(adjacentMode: SceneMode, gapSeconds: number): SceneMode {
  return gapSeconds > 0.01 ? 'default' : adjacentMode;
}

function getAdjacentTransitionMode(
  currentMode: SceneMode,
  adjacentMode: SceneMode | null,
  gapSeconds: number
): SceneMode | null {
  if (adjacentMode === null) {
    return 'default';
  }

  return shouldHoldModeAcrossGap(currentMode, adjacentMode, gapSeconds)
    ? null
    : getModeAcrossGap(adjacentMode, gapSeconds);
}

function getPreviousModeForSegmentEntry(
  segment: SceneSegment,
  prevSegment: SceneSegment | null
): SceneMode | null {
  return getAdjacentTransitionMode(
    segment.mode,
    prevSegment?.mode ?? null,
    prevSegment ? getSegmentGapSeconds(segment.startMs, prevSegment.endMs) : 0
  );
}

function isSegmentEntryTransitionActive(
  segment: SceneSegment | null,
  timeS: number,
  transitionStart: number
): segment is SceneSegment {
  return segment !== null && timeS < segment.startMs / 1000 && timeS >= transitionStart;
}

function createNullableFromModeTransition(
  fromMode: SceneMode | null,
  toMode: SceneMode,
  progress: number
): SceneTransition {
  return fromMode === null
    ? createSceneTransition(toMode, toMode)
    : createSceneTransition(fromMode, toMode, easeTransitionProgress(progress));
}

function getSegmentEntryTransition(
  cursor: SceneSegmentsCursor,
  transitionStart: number
): SceneTransition | null {
  const { timeS, segment, prevSegment } = cursor;
  if (!isSegmentEntryTransitionActive(segment, timeS, transitionStart)) {
    return null;
  }

  const prevMode = getPreviousModeForSegmentEntry(segment, prevSegment);
  const progress = (timeS - transitionStart) / SCENE_TRANSITION_DURATION;
  return createNullableFromModeTransition(prevMode, segment.mode, progress);
}

function getNextModeForSegmentExit(
  segment: SceneSegment,
  nextSegment: SceneSegment | null
): SceneMode | null {
  return getAdjacentTransitionMode(
    segment.mode,
    nextSegment?.mode ?? null,
    nextSegment ? getSegmentGapSeconds(nextSegment.startMs, segment.endMs) : 0
  );
}

function isSegmentExitTransitionActive(
  segment: SceneSegment | null,
  timeS: number,
  transitionEnd: number
): segment is SceneSegment {
  return segment !== null && timeS >= transitionEnd && timeS < segment.endMs / 1000;
}

function createNullableToModeTransition(
  fromMode: SceneMode,
  toMode: SceneMode | null,
  progress: number
): SceneTransition {
  return toMode === null
    ? createSceneTransition(fromMode, fromMode)
    : createSceneTransition(fromMode, toMode, easeTransitionProgress(progress));
}

function getSegmentExitTransition(
  cursor: SceneSegmentsCursor,
  transitionEnd: number
): SceneTransition | null {
  const { timeS, segment } = cursor;
  if (!isSegmentExitTransitionActive(segment, timeS, transitionEnd)) {
    return null;
  }

  const nextSeg = getNextSegment(cursor);
  const nextMode = getNextModeForSegmentExit(segment, nextSeg);
  const progress = (timeS - transitionEnd) / SCENE_TRANSITION_DURATION;
  return createNullableToModeTransition(segment.mode, nextMode, progress);
}

function getActiveSegmentTransition(cursor: SceneSegmentsCursor): SceneTransition {
  const { segment } = cursor;
  if (!segment) {
    return createSceneTransition('default', 'default');
  }

  const transitionStart = segment.startMs / 1000 - SCENE_TRANSITION_DURATION;
  const transitionEnd = segment.endMs / 1000 - SCENE_TRANSITION_DURATION;

  return (
    getSegmentEntryTransition(cursor, transitionStart) ??
    getSegmentExitTransition(cursor, transitionEnd) ??
    createSceneTransition(segment.mode, segment.mode)
  );
}

function getHoldModeAcrossSmallGap(
  prevSegment: SceneSegment | null,
  nextSegment: SceneSegment
): SceneMode | null {
  if (!prevSegment) return null;

  const gap = nextSegment.startMs / 1000 - prevSegment.endMs / 1000;
  return gap < MIN_GAP_FOR_TRANSITION && isSameMode(prevSegment.mode, nextSegment.mode)
    ? prevSegment.mode
    : null;
}

function getGapPreviousMode(
  prevSegment: SceneSegment | null,
  nextSegment: SceneSegment
): SceneMode {
  if (!prevSegment) return 'default';

  const gap = nextSegment.startMs / 1000 - prevSegment.endMs / 1000;
  return gap > 0.01 ? 'default' : prevSegment.mode;
}

function getGapTransitionToNextSegment(
  cursor: SceneSegmentsCursor,
  nextSeg: SceneSegment
): SceneTransition {
  const { timeS, prevSegment } = cursor;
  const transitionStart = nextSeg.startMs / 1000 - SCENE_TRANSITION_DURATION;
  const holdMode = getHoldModeAcrossSmallGap(prevSegment, nextSeg);

  if (holdMode) {
    return createSceneTransition(holdMode, holdMode);
  }

  if (timeS < transitionStart) {
    return createSceneTransition('default', 'default');
  }

  const prevMode = getGapPreviousMode(prevSegment, nextSeg);
  const progress = (timeS - transitionStart) / SCENE_TRANSITION_DURATION;
  return createSceneTransition(prevMode, nextSeg.mode, easeTransitionProgress(progress));
}

function getGapTransition(cursor: SceneSegmentsCursor): SceneTransition {
  const nextSeg = getNextSegment(cursor);
  if (!nextSeg) {
    return createSceneTransition('default', 'default');
  }

  return getGapTransitionToNextSegment(cursor, nextSeg);
}

type CameraOnlyDirection = 'entering' | 'leaving' | 'none';

function getCameraOnlyDirection(currentMode: SceneMode, nextMode: SceneMode): CameraOnlyDirection {
  const isCurrentCameraOnly = currentMode === 'cameraOnly';
  const isNextCameraOnly = nextMode === 'cameraOnly';

  if (isCurrentCameraOnly === isNextCameraOnly) {
    return 'none';
  }

  return isNextCameraOnly ? 'entering' : 'leaving';
}

function getScreenBlur(currentMode: SceneMode, nextMode: SceneMode, transitionProgress: number): number {
  const blurByDirection: Record<CameraOnlyDirection, number> = {
    entering: transitionProgress,
    leaving: lerp(1, 0, transitionProgress),
    none: 0,
  };

  return blurByDirection[getCameraOnlyDirection(currentMode, nextMode)];
}

function getCameraOnlyBlur(
  currentMode: SceneMode,
  nextMode: SceneMode,
  transitionProgress: number
): number {
  const blurByDirection: Record<CameraOnlyDirection, number> = {
    entering: lerp(1, 0, transitionProgress),
    leaving: transitionProgress,
    none: 0,
  };

  return blurByDirection[getCameraOnlyDirection(currentMode, nextMode)];
}

function buildInterpolatedScene(transition: SceneTransition): InterpolatedScene {
  const { currentMode, nextMode, transitionProgress } = transition;
  const startValues = getSceneValues(currentMode);
  const endValues = getSceneValues(nextMode);

  return {
    cameraOpacity: lerp(startValues.cameraOpacity, endValues.cameraOpacity, transitionProgress),
    screenOpacity: lerp(startValues.screenOpacity, endValues.screenOpacity, transitionProgress),
    cameraScale: lerp(startValues.cameraScale, endValues.cameraScale, transitionProgress),
    sceneMode: transitionProgress > 0.5 ? nextMode : currentMode,
    transitionProgress,
    fromMode: currentMode,
    toMode: nextMode,
    screenBlur: getScreenBlur(currentMode, nextMode, transitionProgress),
    cameraOnlyZoom: 1,
    cameraOnlyBlur: getCameraOnlyBlur(currentMode, nextMode, transitionProgress),
  };
}

/**
 * Interpolate scene state at the given cursor position.
 */
function interpolateScene(cursor: SceneSegmentsCursor): InterpolatedScene {
  return buildInterpolatedScene(
    cursor.segment ? getActiveSegmentTransition(cursor) : getGapTransition(cursor)
  );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get interpolated scene state at a specific timestamp.
 */
function getInterpolatedSceneAtSorted(
  sortedSegments: SceneSegment[],
  _defaultMode: SceneMode,
  timestampMs: number
): InterpolatedScene {
  if (!sortedSegments || sortedSegments.length === 0) {
    return fromSingleMode('default');
  }

  const timeS = timestampMs / 1000;
  const cursor = createSceneCursor(timeS, sortedSegments);

  return interpolateScene(cursor);
}

function isTimestampWithinSegment(timestampMs: number, segment: SceneSegment): boolean {
  return timestampMs >= segment.startMs && timestampMs <= segment.endMs;
}

function getActiveSceneSegmentAtSorted(
  sortedSegments: SceneSegment[],
  timestampMs: number
): SceneSegment | undefined {
  const idx = findLastSegmentStartingAtOrBefore(sortedSegments, timestampMs);
  const segment = idx >= 0 ? sortedSegments[idx] : undefined;

  return segment && isTimestampWithinSegment(timestampMs, segment) ? segment : undefined;
}

function getSceneModeAtSorted(
  sortedSegments: SceneSegment[],
  defaultMode: SceneMode,
  timestampMs: number
): SceneMode {
  return getActiveSceneSegmentAtSorted(sortedSegments, timestampMs)?.mode ?? defaultMode;
}

export function getInterpolatedSceneAt(
  segments: SceneSegment[],
  defaultMode: SceneMode,
  timestampMs: number
): InterpolatedScene {
  if (!segments || segments.length === 0) {
    return fromSingleMode('default');
  }
  return getInterpolatedSceneAtSorted(
    sortSceneSegmentsByStart(segments),
    defaultMode,
    timestampMs
  );
}

/**
 * Get the simple scene mode at a specific timestamp (no interpolation).
 * Kept for backward compatibility.
 */
export function getSceneModeAt(
  segments: SceneSegment[],
  defaultMode: SceneMode,
  timestampMs: number
): SceneMode {
  if (!segments || segments.length === 0) {
    return defaultMode;
  }

  return getSceneModeAtSorted(sortSceneSegmentsByStart(segments), defaultMode, timestampMs);
}

/**
 * Hook to get the simple scene mode (backward compatible).
 */
export function useSceneMode(
  segments: SceneSegment[] | undefined,
  defaultMode: SceneMode | undefined,
  currentTimeMs: number
): SceneMode {
  const sortedSegments = useMemo(
    () => (segments && segments.length > 0 ? sortSceneSegmentsByStart(segments) : []),
    [segments]
  );

  return useMemo(
    () => getSceneModeAtSorted(sortedSegments, defaultMode ?? 'default', currentTimeMs),
    [sortedSegments, defaultMode, currentTimeMs]
  );
}

/**
 * Hook to get interpolated scene state with smooth transitions.
 */
export function useInterpolatedScene(
  segments: SceneSegment[] | undefined,
  defaultMode: SceneMode | undefined,
  currentTimeMs: number
): InterpolatedScene {
  const sortedSegments = useMemo(
    () => (segments && segments.length > 0 ? sortSceneSegmentsByStart(segments) : []),
    [segments]
  );

  return useMemo(() => {
    const mode = defaultMode ?? 'default';
    if (sortedSegments.length === 0) {
      return fromSingleMode(mode);
    }
    return getInterpolatedSceneAtSorted(sortedSegments, mode, currentTimeMs);
  }, [sortedSegments, defaultMode, currentTimeMs]);
}

// ============================================================================
// Helper methods for InterpolatedScene
// ============================================================================

export function shouldRenderCamera(scene: InterpolatedScene): boolean {
  return scene.cameraOpacity > 0.01;
}

export function shouldRenderScreen(scene: InterpolatedScene): boolean {
  return scene.screenOpacity > 0.01 || scene.screenBlur > 0.01;
}

export function isTransitioningCameraOnly(scene: InterpolatedScene): boolean {
  return scene.fromMode === 'cameraOnly' || scene.toMode === 'cameraOnly';
}

type CameraOnlyTransitionState = 'leaving' | 'entering' | 'active' | 'none';
type CameraOnlyTransitionKey = 'camera-camera' | 'camera-other' | 'other-camera' | 'other-other';

const CAMERA_ONLY_TRANSITION_STATES: Record<CameraOnlyTransitionKey, CameraOnlyTransitionState> = {
  'camera-camera': 'active',
  'camera-other': 'leaving',
  'other-camera': 'entering',
  'other-other': 'none',
};

function getCameraOnlyTransitionKey(scene: InterpolatedScene): CameraOnlyTransitionKey {
  const from = scene.fromMode === 'cameraOnly' ? 'camera' : 'other';
  const to = scene.toMode === 'cameraOnly' ? 'camera' : 'other';
  return `${from}-${to}` as CameraOnlyTransitionKey;
}

function getCameraOnlyTransitionState(scene: InterpolatedScene): CameraOnlyTransitionState {
  return CAMERA_ONLY_TRANSITION_STATES[getCameraOnlyTransitionKey(scene)];
}

function getFastRegularCameraFade(scene: InterpolatedScene, direction: 'in' | 'out') {
  const progress = scene.transitionProgress * 1.5;
  return direction === 'in'
    ? Math.min(1, progress) * scene.cameraOpacity
    : Math.max(0, 1 - progress) * scene.cameraOpacity;
}

export function getCameraOnlyTransitionOpacity(scene: InterpolatedScene): number {
  const opacityByState: Record<CameraOnlyTransitionState, number> = {
    leaving: 1 - scene.transitionProgress,
    entering: scene.transitionProgress,
    active: 1,
    none: 0,
  };

  return opacityByState[getCameraOnlyTransitionState(scene)];
}

export function getRegularCameraTransitionOpacity(scene: InterpolatedScene): number {
  const opacityByState: Record<CameraOnlyTransitionState, number> = {
    leaving: getFastRegularCameraFade(scene, 'in'),
    entering: getFastRegularCameraFade(scene, 'out'),
    active: 0,
    none: scene.cameraOpacity,
  };

  return opacityByState[getCameraOnlyTransitionState(scene)];
}

/**
 * Should cursor and click highlights be rendered?
 * Returns false when in Camera Only mode (cursor makes no sense without screen content).
 */
export function shouldRenderCursor(scene: InterpolatedScene): boolean {
  const shouldRenderByState: Record<CameraOnlyTransitionState, boolean> = {
    active: false,
    entering: scene.transitionProgress < 0.5,
    leaving: scene.transitionProgress > 0.5,
    none: shouldRenderScreen(scene),
  };

  return shouldRenderByState[getCameraOnlyTransitionState(scene)];
}
