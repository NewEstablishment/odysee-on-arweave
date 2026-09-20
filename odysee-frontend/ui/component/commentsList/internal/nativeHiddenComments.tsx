import React from 'react';
import Button from 'component/button';
import { fetchHyperbeamHiddenComments, fetchHyperbeamCommentVisibility } from 'util/hyperbeam';

// Kept outside the public thread's Redux lists: creator review must not seed
// hidden comments into the normal reader projection.
export default function NativeHiddenComments({ target, onRestore }: { target: string; onRestore: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [result, setResult] = React.useState<CommentListResponse | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true);
    setError('');
    setResult(null);
    fetchHyperbeamHiddenComments(target, page)
      .then((value) => {
        if (active) setResult(value);
      })
      .catch(() => {
        if (active) setError(__('Unable to load hidden comments. Please retry.'));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [target, page, open, refresh]);
  return (
    <section aria-label={__('Hidden comments')}>
      <Button
        button="link"
        label={open ? __('Close hidden comments') : __('Hidden comments')}
        onClick={() => {
          setResult(null);
          setOpen(!open);
        }}
      />
      {open && (
        <>
          <p>{__('Hidden comments are excluded from the public thread, not erased from immutable history.')}</p>
          {error && <p role="alert">{error}</p>}
          <Button
            button="link"
            label={__('Refresh hidden comments')}
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          />
          {busy && <p role="status">{__('Loading…')}</p>}
          {!busy && result && !result.items?.length && <p>{__('No hidden comments.')}</p>}
          <ul>
            {result?.items?.map((comment) => (
              <li key={comment.comment_id}>
                <p>{comment.comment}</p>
                <Button
                  button="link"
                  label={__('Unhide comment')}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await fetchHyperbeamCommentVisibility(comment.comment_id, false);
                      setPage(1);
                      setRefresh((value) => value + 1);
                      onRestore();
                    } catch {
                      setError(__('Unable to restore this comment. Please retry.'));
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
          <Button
            button="link"
            label={__('Previous')}
            disabled={busy || page === 1}
            onClick={() => setPage(page - 1)}
          />
          <Button
            button="link"
            label={__('Next')}
            disabled={busy || !result || page >= result.total_pages}
            onClick={() => setPage(page + 1)}
          />
        </>
      )}
    </section>
  );
}
