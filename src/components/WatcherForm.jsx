import { useState, useEffect } from 'react';
import './WatcherForm.css';
import { ENVIRONMENTS, detectEnvironmentFromUrl } from '../utils/presets';

const DEFAULT_FORM = {
  name: '',
  url: '',
  field: 'version',
  environment: 'sbox',
  interval: 4,
  authHeader: '',
  multiInstance: true,
  confirmations: 2,
  requireAllInstances: true,
};

const SUGGESTED_FIELDS = [
  { field: 'version', label: 'version (Recommended)', desc: 'Best for Frontend builds & API versions' },
  { field: 'buildTime', label: 'buildTime', desc: 'Identical across all Docker containers of a build' },
  { field: 'upTime', label: 'upTime', desc: 'Container start time (or frontend build time)' },
  { field: 'instance', label: 'instance', desc: 'Container Hostname / ID' },
];

export default function WatcherForm({ editingWatcher, onSave, onCancel, insideModal }) {
  const [form, setForm] = useState(DEFAULT_FORM);

  useEffect(() => {
    if (editingWatcher) {
      setForm({
        name: editingWatcher.name || '',
        url: editingWatcher.url || '',
        field: editingWatcher.field || 'version',
        environment: editingWatcher.environment || detectEnvironmentFromUrl(editingWatcher.url || ''),
        interval: editingWatcher.interval || 4,
        authHeader: editingWatcher.authHeader || '',
        multiInstance: editingWatcher.multiInstance !== false,
        confirmations: editingWatcher.confirmations || 2,
        requireAllInstances: editingWatcher.requireAllInstances !== false,
      });
    } else {
      setForm(DEFAULT_FORM);
    }
  }, [editingWatcher]);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm((prev) => {
      const updated = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value,
      };
      if (name === 'url') {
        const detected = detectEnvironmentFromUrl(value);
        if (detected !== 'custom') {
          updated.environment = detected;
        }
      }
      return updated;
    });
  }

  function handleFieldChipClick(f) {
    setForm((prev) => ({ ...prev, field: f }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.url.trim()) return;
    onSave({
      name: form.name.trim(),
      url: form.url.trim(),
      field: form.field.trim() || 'version',
      environment: form.environment || detectEnvironmentFromUrl(form.url.trim()),
      interval: Math.max(2, parseInt(form.interval, 10) || 4),
      authHeader: form.authHeader.trim(),
      multiInstance: !!form.multiInstance,
      confirmations: Math.max(1, parseInt(form.confirmations, 10) || 2),
      requireAllInstances: !!form.requireAllInstances,
    });
    if (!editingWatcher) setForm(DEFAULT_FORM);
  }

  const isEditing = !!editingWatcher;
  const wrapClass = insideModal ? 'watcher-form watcher-form--modal' : 'panel watcher-form';

  return (
    <div className={wrapClass}>
      <div className="form-title">
        {isEditing ? (
          <><span className="form-title__icon">✏️</span> Edit watcher</>
        ) : (
          <><span className="form-title__icon">➕</span> Add a watcher</>
        )}
      </div>

      <form onSubmit={handleSubmit} autoComplete="off">
        <div className="field-row">
          <div className="field">
            <label htmlFor="wName">Label <span className="field__hint">(optional — defaults to domain)</span></label>
            <input
              id="wName"
              name="name"
              type="text"
              placeholder="e.g. Prisma API or Tenant Portal"
              value={form.name}
              onChange={handleChange}
              autoFocus={insideModal}
            />
          </div>
          <div className="field field--narrow">
            <label htmlFor="wEnv">Environment</label>
            <select
              id="wEnv"
              name="environment"
              className="field-select"
              value={form.environment}
              onChange={handleChange}
            >
              {ENVIRONMENTS.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="wUrl">Target URL <span className="field__required">*</span></label>
          <input
            id="wUrl"
            name="url"
            type="text"
            placeholder="https://app.goprisma-dev.com/meta.json or https://api.goprisma-dev.com/v"
            value={form.url}
            onChange={handleChange}
            required
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="wField">
              Field to track <span className="field__hint">(supports deep paths e.g. data.version)</span>
            </label>
            <input
              id="wField"
              name="field"
              type="text"
              value={form.field}
              onChange={handleChange}
            />
            <div className="field-chips">
              <span className="field-chips__label">Suggestions:</span>
              {SUGGESTED_FIELDS.map((sf) => (
                <button
                  key={sf.field}
                  type="button"
                  className={`chip-btn ${form.field === sf.field ? 'chip-btn--active' : ''}`}
                  onClick={() => handleFieldChipClick(sf.field)}
                  title={sf.desc}
                >
                  {sf.field}
                </button>
              ))}
            </div>
          </div>
          <div className="field field--narrow">
            <label htmlFor="wInterval">Interval <span className="field__hint">(sec)</span></label>
            <input
              id="wInterval"
              name="interval"
              type="number"
              min="2"
              value={form.interval}
              onChange={handleChange}
            />
          </div>
        </div>


        {/* Multi-instance settings */}
        <div className="field-row field-row--options">
          <div className="field-checkbox">
            <label>
              <input
                type="checkbox"
                name="multiInstance"
                checked={form.multiInstance}
                onChange={handleChange}
              />
              <span>Multi-instance pool tracking (avoids load-balancer false alarms)</span>
            </label>
          </div>
        </div>

        <div className="field-row field-row--options">
          <div className="field field--half">
            <label htmlFor="wConfirmations">
              Confirmations required <span className="field__hint">(consecutive checks)</span>
            </label>
            <input
              id="wConfirmations"
              name="confirmations"
              type="number"
              min="1"
              max="5"
              value={form.confirmations}
              onChange={handleChange}
            />
          </div>
          <div className="field-checkbox field-checkbox--inline">
            <label>
              <input
                type="checkbox"
                name="requireAllInstances"
                checked={form.requireAllInstances}
                onChange={handleChange}
              />
              <span>Require all detected instances to update</span>
            </label>
          </div>
        </div>

        <div className="field">
          <label htmlFor="wAuth">Auth header <span className="field__hint">(optional)</span></label>
          <input
            id="wAuth"
            name="authHeader"
            type="text"
            placeholder="e.g. Bearer xyz — leave blank if none"
            value={form.authHeader}
            onChange={handleChange}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn--primary">
            {isEditing ? 'Save Changes' : 'Add Watcher'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>

        <div className="storage-note">
          💾 Watchers persist across reloads via browser localStorage.
        </div>
      </form>
    </div>
  );
}
