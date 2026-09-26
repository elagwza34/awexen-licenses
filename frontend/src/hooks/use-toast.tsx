import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';

type ToastVariant = 'default' | 'success' | 'destructive' | 'warning';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  show: (title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

/**
 * Controlled toast host.
 *
 * This Radix version ships no imperative `toast()` helper, so the provider
 * owns the queue and renders it. That is preferable anyway: toasts become
 * controllable, testable and declaratively dismissed.
 */
const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

export function ToastProviderHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((variant: ToastVariant, title: string, description?: string) => {
    const id = nextId++;
    setToasts((current) => [...current, { id, title, description, variant }]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show: (title, description) => push('default', title, description),
      success: (title, description) => push('success', title, description),
      error: (title, description) => push('destructive', title, description),
      warning: (title, description) => push('warning', title, description),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastProvider>
        {children}
        {toasts.map((item) => (
          <Toast
            key={item.id}
            variant={item.variant}
            duration={item.variant === 'destructive' ? 7000 : 4000}
            onOpenChange={(open) => !open && dismiss(item.id)}
          >
            <div className="grid gap-1">
              <ToastTitle>{item.title}</ToastTitle>
              {item.description && <ToastDescription>{item.description}</ToastDescription>}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProviderHost');
  return context;
}
