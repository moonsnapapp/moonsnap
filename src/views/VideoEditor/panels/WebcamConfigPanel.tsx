/**
 * WebcamConfigPanel - Webcam overlay position, shape, border settings.
 */
import { Circle, Square, Monitor } from 'lucide-react';
import { Slider } from '../../../components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '../../../components/ui/toggle-group';
import { PositionGrid } from '../PositionGrid';
import type { VideoProject, WebcamConfig, WebcamOverlayShape } from '../../../types';

export interface WebcamConfigPanelProps {
  project: VideoProject;
  onUpdateWebcamConfig: (updates: Partial<WebcamConfig>) => void;
}

export function WebcamConfigPanel({ project, onUpdateWebcamConfig }: WebcamConfigPanelProps) {
  return (
    <div className="space-y-4">
      {/* Show/Hide Toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Show Overlay</span>
        <button
          onClick={() => onUpdateWebcamConfig({ enabled: !project.webcam.enabled })}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            project.webcam.enabled ? 'bg-[var(--coral-400)]' : 'bg-[var(--polar-frost)]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              project.webcam.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Size Slider */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--ink-muted)]">Size</span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {Math.round(project.webcam.size * 100)}%
          </span>
        </div>
        <Slider
          value={[project.webcam.size * 100]}
          onValueChange={(values) => onUpdateWebcamConfig({ size: values[0] / 100 })}
          min={10}
          max={50}
          step={1}
        />
      </div>

      {/* Shape Toggle */}
      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">Shape</span>
        <ToggleGroup
          type="single"
          value={project.webcam.shape}
          onValueChange={(value) => {
            if (value) onUpdateWebcamConfig({ shape: value as WebcamOverlayShape });
          }}
          className="justify-start"
        >
          <ToggleGroupItem value="circle" aria-label="Circle" className="h-8 w-8 p-0 data-[state=on]:bg-[var(--polar-frost)]">
            <Circle className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="roundedRectangle" aria-label="Squircle" className="h-8 w-8 p-0 data-[state=on]:bg-[var(--polar-frost)]">
            <Square className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="source" aria-label="Source" className="h-8 w-8 p-0 data-[state=on]:bg-[var(--polar-frost)]">
            <Monitor className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Rounding (for roundedRectangle and source shapes) */}
      {(project.webcam.shape === 'roundedRectangle' || project.webcam.shape === 'source') && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--ink-muted)]">Rounding</span>
            <span className="text-xs text-[var(--ink-subtle)]">{Math.round(project.webcam.rounding)}%</span>
          </div>
          <Slider
            value={[project.webcam.rounding]}
            onValueChange={(values) => onUpdateWebcamConfig({ rounding: values[0] })}
            min={0}
            max={100}
            step={1}
            className="w-full"
          />
        </div>
      )}

      {/* Shadow */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--ink-muted)]">Shadow</span>
          <span className="text-xs text-[var(--ink-subtle)]">{Math.round(project.webcam.shadow)}%</span>
        </div>
        <Slider
          value={[project.webcam.shadow]}
          onValueChange={(values) => onUpdateWebcamConfig({ shadow: values[0] })}
          min={0}
          max={100}
          step={1}
          className="w-full"
        />
      </div>

      {/* Position Grid */}
      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">Position</span>
        <PositionGrid
          position={project.webcam.position}
          customX={project.webcam.customX}
          customY={project.webcam.customY}
          onChange={(pos, x, y) => onUpdateWebcamConfig({ position: pos, customX: x, customY: y })}
        />
      </div>

      {/* Segments count */}
      <div className="pt-3 border-t border-[var(--glass-border)]">
        <label className="text-[10px] text-[var(--ink-subtle)] uppercase">Visibility Segments</label>
        <p className="text-xs text-[var(--ink-dark)] mt-0.5">
          {project.webcam.visibilitySegments.length} segment{project.webcam.visibilitySegments.length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
}
