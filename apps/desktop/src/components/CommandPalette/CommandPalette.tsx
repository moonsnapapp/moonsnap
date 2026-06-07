/**
 * Command Palette - Quick access to tools, actions, and navigation
 *
 * Keyboard shortcut: Ctrl+K / Cmd+K
 * Uses cmdk library with existing command primitives
 */

import React, { useCallback, useMemo } from 'react';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from '@/components/ui/command';
import {
  MousePointer,
  Crop,
  MoveRight,
  Minus,
  Square,
  Circle,
  Type,
  Highlighter,
  Blinds,
  ListOrdered,
  Pen,
  Palette,
  Copy,
  Save,
  Undo2,
  Redo2,
  ZoomIn,
  Settings,
  Keyboard,
  Trash2,
  ArrowLeft,
} from 'lucide-react';
import type { Tool } from '@/types';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Editor state
  view: 'library' | 'editor' | 'videoEditor';
  selectedTool: Tool;
  hasProject: boolean;
  canUndo: boolean;
  canRedo: boolean;
  // Actions
  onToolChange: (tool: Tool) => void;
  onCopy: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFitToCenter: () => void;
  onShowShortcuts: () => void;
  onOpenSettings: () => void;
  onBackToLibrary: () => void;
  onRequestDelete: () => void;
  onToggleCompositor: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
}

interface CommandSection {
  name: string;
  commands: CommandItem[];
}

const TOOL_ICONS: Record<Tool, React.ReactNode> = {
  select: <MousePointer className="h-4 w-4" />,
  crop: <Crop className="h-4 w-4" />,
  arrow: <MoveRight className="h-4 w-4" />,
  line: <Minus className="h-4 w-4" />,
  rect: <Square className="h-4 w-4" />,
  circle: <Circle className="h-4 w-4" />,
  text: <Type className="h-4 w-4" />,
  highlight: <Highlighter className="h-4 w-4" />,
  blur: <Blinds className="h-4 w-4" />,
  steps: <ListOrdered className="h-4 w-4" />,
  pen: <Pen className="h-4 w-4" />,
  background: <Palette className="h-4 w-4" />,
};

const TOOL_SHORTCUTS: Partial<Record<Tool, string>> = {
  select: 'V',
  crop: 'C',
  arrow: 'A',
  line: 'L',
  rect: 'R',
  circle: 'E',
  text: 'T',
  highlight: 'H',
  blur: 'B',
  steps: 'S',
  pen: 'P',
  background: 'G',
};

const TOOL_LABELS: Record<Tool, string> = {
  select: 'Select',
  crop: 'Crop',
  arrow: 'Arrow',
  line: 'Line',
  rect: 'Rectangle',
  circle: 'Ellipse',
  text: 'Text',
  highlight: 'Highlight',
  blur: 'Blur',
  steps: 'Steps',
  pen: 'Pen',
  background: 'Background',
};

// Tool categories for grouped command palette
const TOOL_CATEGORIES: { name: string; tools: Tool[] }[] = [
  { name: 'Selection', tools: ['select', 'crop'] },
  { name: 'Shapes', tools: ['rect', 'circle', 'arrow', 'line'] },
  { name: 'Annotation', tools: ['text', 'steps', 'highlight', 'blur', 'pen'] },
  { name: 'Effects', tools: ['background'] },
];

function getToolCommandAction({
  tool,
  onToolChange,
  onToggleCompositor,
}: {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onToggleCompositor: () => void;
}) {
  return () => {
    if (tool === 'background') {
      onToggleCompositor();
    }
    onToolChange(tool);
  };
}

function getGroupedToolCommands({
  isEditor,
  selectedTool,
  onToolChange,
  onToggleCompositor,
}: {
  isEditor: boolean;
  selectedTool: Tool;
  onToolChange: (tool: Tool) => void;
  onToggleCompositor: () => void;
}): CommandSection[] {
  if (!isEditor) return [];

  return TOOL_CATEGORIES.map((category) => ({
    name: category.name,
    commands: category.tools.map((tool) => ({
      id: `tool-${tool}`,
      label: TOOL_LABELS[tool],
      icon: TOOL_ICONS[tool],
      shortcut: TOOL_SHORTCUTS[tool],
      action: getToolCommandAction({ tool, onToolChange, onToggleCompositor }),
      disabled: tool === selectedTool,
    })),
  }));
}

function getEditorActionCommands({
  isEditor,
  hasProject,
  canUndo,
  canRedo,
  onCopy,
  onSave,
  onUndo,
  onRedo,
  onFitToCenter,
  onRequestDelete,
}: Pick<
  CommandPaletteProps,
  | 'hasProject'
  | 'canUndo'
  | 'canRedo'
  | 'onCopy'
  | 'onSave'
  | 'onUndo'
  | 'onRedo'
  | 'onFitToCenter'
  | 'onRequestDelete'
> & {
  isEditor: boolean;
}): CommandItem[] {
  if (!isEditor || !hasProject) return [];

  return [
    {
      id: 'copy',
      label: 'Copy to Clipboard',
      icon: <Copy className="h-4 w-4" />,
      shortcut: '⌘C',
      action: onCopy,
    },
    {
      id: 'save',
      label: 'Save to File',
      icon: <Save className="h-4 w-4" />,
      shortcut: '⌘S',
      action: onSave,
    },
    {
      id: 'undo',
      label: 'Undo',
      icon: <Undo2 className="h-4 w-4" />,
      shortcut: '⌘Z',
      action: onUndo,
      disabled: !canUndo,
    },
    {
      id: 'redo',
      label: 'Redo',
      icon: <Redo2 className="h-4 w-4" />,
      shortcut: '⌘⇧Z',
      action: onRedo,
      disabled: !canRedo,
    },
    {
      id: 'fit',
      label: 'Fit to Center',
      icon: <ZoomIn className="h-4 w-4" />,
      shortcut: 'F',
      action: onFitToCenter,
    },
    {
      id: 'delete',
      label: 'Delete Capture',
      icon: <Trash2 className="h-4 w-4" />,
      action: onRequestDelete,
    },
  ];
}

function getNavigationCommands({
  isEditor,
  onBackToLibrary,
  onOpenSettings,
  onShowShortcuts,
}: Pick<
  CommandPaletteProps,
  'onBackToLibrary' | 'onOpenSettings' | 'onShowShortcuts'
> & {
  isEditor: boolean;
}): CommandItem[] {
  return [
    ...(isEditor
      ? [{
          id: 'library',
          label: 'Back to Library',
          icon: <ArrowLeft className="h-4 w-4" />,
          action: onBackToLibrary,
        }]
      : []),
    {
      id: 'settings',
      label: 'Open Settings',
      icon: <Settings className="h-4 w-4" />,
      action: onOpenSettings,
    },
    {
      id: 'shortcuts',
      label: 'Keyboard Shortcuts',
      icon: <Keyboard className="h-4 w-4" />,
      shortcut: '?',
      action: onShowShortcuts,
    },
  ];
}

function getCommandSections({
  toolSections,
  actionCommands,
  navigationCommands,
}: {
  toolSections: CommandSection[];
  actionCommands: CommandItem[];
  navigationCommands: CommandItem[];
}): CommandSection[] {
  return [
    ...toolSections,
    ...(actionCommands.length > 0 ? [{ name: 'Actions', commands: actionCommands }] : []),
    { name: 'Navigation', commands: navigationCommands },
  ];
}

function CommandPaletteCommand({
  command,
  runCommand,
}: {
  command: CommandItem;
  runCommand: (action: () => void) => void;
}) {
  return (
    <CommandItem
      key={command.id}
      onSelect={() => runCommand(command.action)}
      disabled={command.disabled}
    >
      {command.icon}
      <span>{command.label}</span>
      {command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
    </CommandItem>
  );
}

function CommandPaletteSection({
  section,
  runCommand,
}: {
  section: CommandSection;
  runCommand: (action: () => void) => void;
}) {
  return (
    <CommandGroup heading={section.name}>
      {section.commands.map((command) => (
        <CommandPaletteCommand
          key={command.id}
          command={command}
          runCommand={runCommand}
        />
      ))}
    </CommandGroup>
  );
}

function CommandPaletteSections({
  sections,
  runCommand,
}: {
  sections: CommandSection[];
  runCommand: (action: () => void) => void;
}) {
  return (
    <>
      {sections.map((section, index) => (
        <React.Fragment key={section.name}>
          {index > 0 && <CommandSeparator />}
          <CommandPaletteSection section={section} runCommand={runCommand} />
        </React.Fragment>
      ))}
    </>
  );
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpenChange,
  view,
  selectedTool,
  hasProject,
  canUndo,
  canRedo,
  onToolChange,
  onCopy,
  onSave,
  onUndo,
  onRedo,
  onFitToCenter,
  onShowShortcuts,
  onOpenSettings,
  onBackToLibrary,
  onRequestDelete,
  onToggleCompositor,
}) => {
  const runCommand = useCallback((action: () => void) => {
    onOpenChange(false);
    // Small delay to let dialog close before action
    requestAnimationFrame(action);
  }, [onOpenChange]);

  const isEditor = view === 'editor';

  const groupedToolCommands = useMemo(() => getGroupedToolCommands({
    isEditor,
    selectedTool,
    onToolChange,
    onToggleCompositor,
  }), [isEditor, selectedTool, onToolChange, onToggleCompositor]);

  const actionCommands = useMemo(() => getEditorActionCommands({
    isEditor,
    hasProject,
    canUndo,
    canRedo,
    onCopy,
    onSave,
    onUndo,
    onRedo,
    onFitToCenter,
    onRequestDelete,
  }), [isEditor, hasProject, canUndo, canRedo, onCopy, onSave, onUndo, onRedo, onFitToCenter, onRequestDelete]);
  const navigationCommands = useMemo(() => getNavigationCommands({
    isEditor,
    onBackToLibrary,
    onOpenSettings,
    onShowShortcuts,
  }), [isEditor, onBackToLibrary, onOpenSettings, onShowShortcuts]);

  const sections = useMemo(() => getCommandSections({
    toolSections: groupedToolCommands,
    actionCommands,
    navigationCommands,
  }), [groupedToolCommands, actionCommands, navigationCommands]);
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandPaletteSections sections={sections} runCommand={runCommand} />
      </CommandList>
    </CommandDialog>
  );
};
