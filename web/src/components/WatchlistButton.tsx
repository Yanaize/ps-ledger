import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function WatchlistButton({
  conceptId,
  title,
  coverUrl,
  preferredProductId,
}: {
  conceptId: string;
  title: string;
  coverUrl: string | null;
  preferredProductId?: string | null;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['watchlist', conceptId],
    queryFn: () => api.watchlistItem(conceptId),
  });

  const add = useMutation({
    mutationFn: () =>
      api.addToWatchlist({
        conceptId,
        title: title || 'Game',
        coverUrl,
        preferredProductId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlist'] });
      qc.invalidateQueries({ queryKey: ['tracking'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.removeFromWatchlist(conceptId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });

  const onList = Boolean(q.data?.item);
  const pending = add.isPending || remove.isPending;

  return (
    <button
      type="button"
      className={`btn sm ${onList ? '' : 'primary'}`}
      disabled={pending || q.isLoading}
      onClick={() => (onList ? remove.mutate() : add.mutate())}
    >
      {pending ? 'Saving…' : onList ? 'On watchlist' : 'Add to watchlist'}
    </button>
  );
}
