import { useEffect, useRef, useState } from 'react';
import { FileImage, Loader2 } from 'lucide-react';

/**
 * Opens a stored receipt in a new tab.
 *
 * Both the owner panel and the customer portal link to receipts, and neither
 * can do it with a plain `<a href>`: the route needs a bearer token, and a link
 * carries no Authorization header. The naive version 404'd — the browser
 * resolved the bare `/receipts/...` against the Vite dev server, which answered
 * the SPA shell instead of the image.
 *
 * The file is fetched with the token and shown through an object URL, which is
 * revoked when the component unmounts so a long session does not accumulate
 * copies of bank images in memory.
 */
export function ReceiptLink({
  url,
  label,
  className,
  iconSize = 'size-3',
  fetcher,
}: {
  /** The stored `/receipts/<uuid>.png` value, or the portal's own route. */
  url: string;
  label: string;
  className?: string;
  iconSize?: string;
  /**
   * Overrides how the bytes are fetched. The owner panel and the portal hold
   * separate tokens, so the caller supplies the session rather than this
   * component guessing which one is current.
   */
  fetcher?: (url: string) => Promise<Blob>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const objectUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const open = () => {
    setError(null);
    // `useTransition` only tracks the synchronous part of an async function, so
    // the loading state is held explicitly instead — otherwise the spinner would
    // flash and vanish before the image arrives.
    setIsPending(true);
    (async () => {
      try {
        const blob = fetcher ? await fetcher(url) : await fetchReceiptBlob(url);
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);

        const opened = window.open(objectUrl.current, '_blank', 'noopener,noreferrer');
        if (!opened) {
          // Pop-up blockers are the most likely failure here, and the customer
          // cannot debug them, so say what happened instead of failing silently.
          setError('المتصفح منع فتح النافذة. اسمح بالنوافذ المنبثقة لهذا الموقع.');
        }
      } catch {
        setError('تعذّر فتح الحوالة. حدّث الصفحة وحاول مرة أخرى.');
      } finally {
        setIsPending(false);
      }
    })();
  };

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={open}
        disabled={isPending}
        title={label}
        className={className}
      >
        {isPending ? (
          <Loader2 className={`${iconSize} animate-spin`} />
        ) : (
          <FileImage className={iconSize} />
        )}
        {label}
      </button>
      {error && <span className="mt-0.5 text-[11px] text-destructive">{error}</span>}
    </span>
  );
}

/**
 * Fetches a receipt with whatever token the shared API client holds.
 *
 * The admin client and the portal client are deliberately separate, so the
 * caller says which session to use rather than this module guessing.
 */
async function fetchReceiptBlob(url: string): Promise<Blob> {
  const { api } = await import('@/lib/api');
  return api.getBlob(url);
}
