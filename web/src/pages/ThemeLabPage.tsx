import { THEME_META, THEMES } from '../theme';

export function ThemeLabPage() {
  return (
    <div>
      <h1 className="page-title">Theme lab</h1>
      <p className="page-sub">Development only. Switch themes in Settings, then scan these samples.</p>
      <div className="theme-grid" style={{ marginTop: '1rem' }}>
        {THEMES.map((id) => (
          <div key={id} className="theme-card">
            <span className="theme-swatch" style={{ background: THEME_META[id].bg, color: THEME_META[id].text }}>
              <span style={{ background: THEME_META[id].surface }} />
              <i style={{ background: THEME_META[id].accent }} />
            </span>
            {THEME_META[id].name}
          </div>
        ))}
      </div>
      <div className="region-grid" style={{ marginTop: '1rem' }}>
        <article className="region-card is-best">
          <h3>Best price</h3>
          <div className="price-primary">₪126.61<span className="currency-note">Direct conversion</span></div>
          <span className="badge ok">In Stock</span>
          <span className="badge warn">Stale</span>
          <span className="badge danger">Unavailable</span>
        </article>
        <article className="panel">
          <button type="button" className="btn primary">Primary</button>
          <button type="button" className="btn" style={{ marginLeft: 8 }}>Secondary</button>
          <input className="input" defaultValue="Input" style={{ marginTop: 12, display: 'block' }} />
        </article>
      </div>
    </div>
  );
}
