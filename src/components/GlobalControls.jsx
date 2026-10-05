import './GlobalControls.css';
import { ENVIRONMENTS } from '../utils/presets';

export default function GlobalControls({
  activeFilter,
  onSelectFilter,
  onStartFiltered,
  onStopFiltered,
  countsByEnv = {},
  runningByEnv = {},
  onResetAll,
}) {
  const filterLabel =
    activeFilter === 'all'
      ? 'All'
      : (ENVIRONMENTS.find((e) => e.id === activeFilter)?.label || activeFilter.toUpperCase());

  const currentCount = countsByEnv[activeFilter] || 0;
  const currentRunning = runningByEnv[activeFilter] || 0;

  function handleResetClick() {
    if (
      window.confirm(
        'Reset all watchers to the default 30 endpoints (all environments: Sbox, Dev, Lab, Demo, Prod)?'
      )
    ) {
      onResetAll();
    }
  }

  return (
    <div className="global-controls-wrapper">
      {/* Environment Filter Tabs Bar */}
      <div className="env-filter-bar">
        <span className="env-filter-label">Filter:</span>
        <div className="env-filter-tabs">
          <button
            type="button"
            className={`filter-tab ${activeFilter === 'all' ? 'filter-tab--active' : ''}`}
            onClick={() => onSelectFilter('all')}
          >
            All <span className="filter-badge">{countsByEnv.all || 0}</span>
            {runningByEnv.all > 0 && <span className="running-dot" title={`${runningByEnv.all} running`} />}
          </button>

          {ENVIRONMENTS.map((env) => {
            const count = countsByEnv[env.id] || 0;
            const running = runningByEnv[env.id] || 0;
            return (
              <button
                key={env.id}
                type="button"
                className={`filter-tab filter-tab--${env.id} ${
                  activeFilter === env.id ? 'filter-tab--active' : ''
                }`}
                onClick={() => onSelectFilter(env.id)}
              >
                {env.label} <span className="filter-badge">{count}</span>
                {running > 0 && <span className="running-dot" title={`${running} running`} />}
              </button>
            );
          })}

          {countsByEnv.custom > 0 && (
            <button
              type="button"
              className={`filter-tab ${activeFilter === 'custom' ? 'filter-tab--active' : ''}`}
              onClick={() => onSelectFilter('custom')}
            >
              Custom <span className="filter-badge">{countsByEnv.custom}</span>
              {runningByEnv.custom > 0 && <span className="running-dot" title={`${runningByEnv.custom} running`} />}
            </button>
          )}
        </div>

        <button
          type="button"
          className="btn-reset-presets"
          onClick={handleResetClick}
          title="Reset to default 30 endpoints across all environments"
        >
          ↺ Reset All Presets
        </button>
      </div>

      {/* Start / Stop buttons operating on active filter */}
      <div className="global-controls">
        <button
          className="btn btn--secondary"
          onClick={onStartFiltered}
          disabled={currentCount === 0}
        >
          <span className="btn-icon">▶</span> Start {filterLabel} ({currentCount})
        </button>
        <button
          className="btn btn--secondary"
          onClick={onStopFiltered}
          disabled={currentRunning === 0 && currentCount === 0}
        >
          <span className="btn-icon">■</span> Stop {filterLabel}{' '}
          {currentRunning > 0 ? `(${currentRunning} running)` : ''}
        </button>
      </div>
    </div>
  );
}
