import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SearchResultItem } from '@ps-price-compare/shared';
import { api } from '../api/client';
import { rememberRecent } from '../recent';

export function CommandSearch({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (conceptId: string, item: SearchResultItem) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length >= 2,
  });

  const results = useMemo(() => (search.data?.results ?? []).slice(0, 8), [search.data]);

  useEffect(() => setActive(0), [debounced]);

  async function choose(item: SearchResultItem) {
    let conceptId = item.conceptId;
    if (!conceptId) {
      const resolved = await api.resolveConcept(item.productId);
      conceptId = resolved.conceptId;
    }
    if (!conceptId) return;
    rememberRecent({ conceptId, title: item.name, coverUrl: item.coverUrl });
    onOpen(conceptId, item);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && results[active]) void choose(results[active]);
  }

  return (
    <div className="command-layer" onMouseDown={onClose}>
      <div className="command" role="dialog" aria-label="Search games" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          placeholder="Search PlayStation games…"
          aria-label="Search PlayStation games"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <ul>
          {debounced.length < 2 && (
            <li className="command-hint">Type at least two characters.</li>
          )}
          {search.isFetching && <li className="command-hint">Searching…</li>}
          {results.map((r, i) => (
            <li key={r.productId}>
              <button type="button" aria-selected={i === active} onClick={() => void choose(r)}>
                {r.coverUrl ? <img className="cover-thumb" src={r.coverUrl} alt="" /> : <span className="cover-placeholder" />}
                <span>
                  <div className="result-title">{r.name}</div>
                  <div className="result-meta">{r.platforms.join(' · ')}</div>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
