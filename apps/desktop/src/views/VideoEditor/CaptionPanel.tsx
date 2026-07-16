import { CaptionPanelContent } from './captions/CaptionPanelContent';

interface CaptionPanelProps {
  videoPath: string | null;
}

export function CaptionPanel(props: CaptionPanelProps) {
  return <CaptionPanelContent {...props} />;
}
