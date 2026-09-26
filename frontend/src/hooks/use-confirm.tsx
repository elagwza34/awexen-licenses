import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  /**
   * When set, the user must type this exact text before confirming. Used for
   * irreversible actions like revoking a license.
   */
  requireTypedConfirmation?: string;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
}

/**
 * Destructive actions in this panel (revoke, refund, delete, reset device)
 * always go through this dialog. It exposes an imperative API so callers do
 * not have to duplicate the markup.
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [typed, setTyped] = useState('');

  const confirm = (options: ConfirmOptions, onConfirm: () => void) => {
    setTyped('');
    setState({ ...options, open: true, onConfirm });
  };

  const close = () => setState(null);

  const isLocked = Boolean(state?.requireTypedConfirmation) && typed !== state?.requireTypedConfirmation;

  const dialog = state ? (
    <Dialog open={state.open} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state.variant === 'destructive' && <AlertTriangle className="h-5 w-5 text-destructive" />}
            {state.title}
          </DialogTitle>
          <DialogDescription>{state.description}</DialogDescription>
        </DialogHeader>

        {state.requireTypedConfirmation && (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="confirm-input">
              اكتب <span className="ltr font-mono text-destructive">{state.requireTypedConfirmation}</span> للتأكيد
            </label>
            <input
              id="confirm-input"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ltr"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            variant={state.variant === 'destructive' ? 'destructive' : 'default'}
            onClick={() => {
              state.onConfirm();
              close();
            }}
            disabled={isLocked}
          >
            {state.confirmLabel ?? 'تأكيد'}
          </Button>
          <Button variant="outline" onClick={close}>
            {state.cancelLabel ?? 'إلغاء'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { confirm, confirmDialog: dialog as ReactNode };
}
