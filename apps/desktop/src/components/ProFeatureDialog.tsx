import { Lock } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LICENSE } from '@/constants';

interface ProFeatureDialogProps {
  open: boolean;
  featureName: string;
  onOpenChange: (open: boolean) => void;
}

export function ProFeatureDialog({ open, featureName, onOpenChange }: ProFeatureDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--coral-100)] text-[var(--coral-600)]">
            <Lock className="h-4 w-4" />
          </div>
          <AlertDialogTitle>{featureName} is disabled in Free mode</AlertDialogTitle>
          <AlertDialogDescription>
            Your Pro trial has ended or MoonSnap is currently running in Free mode. Upgrade to Pro
            to keep using these editing features:
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="grid gap-2 text-sm text-[var(--ink-dark)]">
          {LICENSE.FREE_MODE_DISABLED_FEATURES.map((feature) => (
            <li key={feature} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--coral-500)]" />
              {feature}
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              window.open(LICENSE.PURCHASE_URL, '_blank');
            }}
          >
            Upgrade to Pro
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
