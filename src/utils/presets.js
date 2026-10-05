export const ENVIRONMENTS = [
  { id: 'sbox', label: 'Sbox' },
  { id: 'dev', label: 'Dev' },
  { id: 'lab', label: 'Lab' },
  { id: 'demo', label: 'Demo' },
  { id: 'prod', label: 'Production' },
];

/**
 * Automatically infers environment identifier from URL string
 */
export function detectEnvironmentFromUrl(url = '') {
  const lower = url.toLowerCase();
  if (lower.includes('-sbox')) return 'sbox';
  if (lower.includes('-dev')) return 'dev';
  if (lower.includes('-lab')) return 'lab';
  if (lower.includes('-demo')) return 'demo';
  if (lower.includes('goprisma.com')) return 'prod';
  return 'custom';
}

/**
 * Returns the 6 standard endpoints for a given environment:
 * - Admin API (/v)
 * - Tenant API (/v)
 * - Queue API (/v)
 * - Payment API (/v)
 * - Admin Console Frontend (app.../meta.json)
 * - Tenant Console Frontend (tenant.../meta.json)
 */
export function getEnvironmentPresets(env = 'sbox') {
  const normEnv = env.toLowerCase();
  const postfix = normEnv === 'prod' || normEnv === 'production' ? '' : `-${normEnv}`;
  const envLabel = normEnv.toUpperCase();

  return [
    {
      id: `preset_admin_api_${normEnv}`,
      name: `Admin API (${envLabel})`,
      url: `https://api.goprisma${postfix}.com/v`,
      field: 'version',
      environment: normEnv,
      interval: 4,
      multiInstance: true,
      confirmations: normEnv === 'prod' ? 2 : 1,
      authHeader: '',
    },
    {
      id: `preset_tenant_api_${normEnv}`,
      name: `Tenant API (${envLabel})`,
      url: `https://tenant-api.goprisma${postfix}.com/v`,
      field: 'version',
      environment: normEnv,
      interval: 4,
      multiInstance: true,
      confirmations: normEnv === 'prod' ? 2 : 1,
      authHeader: '',
    },
    {
      id: `preset_queue_api_${normEnv}`,
      name: `Queue API (${envLabel})`,
      url: `https://q-api.goprisma${postfix}.com/v`,
      field: 'version',
      environment: normEnv,
      interval: 4,
      multiInstance: true,
      confirmations: normEnv === 'prod' ? 2 : 1,
      authHeader: '',
    },
    {
      id: `preset_payment_service_${normEnv}`,
      name: `Payment API (${envLabel})`,
      url: `https://p-api.goprisma${postfix}.com/v`,
      field: 'version',
      environment: normEnv,
      interval: 4,
      multiInstance: true,
      confirmations: normEnv === 'prod' ? 2 : 1,
      authHeader: '',
    },
    {
      id: `preset_admin_console_${normEnv}`,
      name: `Admin App Frontend (${envLabel})`,
      url: `https://app.goprisma${postfix}.com/meta.json`,
      field: 'version',
      environment: normEnv,
      interval: 4,
      multiInstance: false,
      confirmations: 1,
      authHeader: '',
    },
    {
      id: `preset_tenant_console_${normEnv}`,
      name: `Tenant App Frontend (${envLabel})`,
      url: `https://tenant.goprisma${postfix}.com/meta.json`,
      field: 'version',
      environment: normEnv,
      interval: 4,
      multiInstance: false,
      confirmations: 1,
      authHeader: '',
    },
  ];
}

/**
 * Returns all standard presets across all 5 environments (sbox, dev, lab, demo, prod).
 */
export function getAllEnvironmentPresets() {
  return ENVIRONMENTS.flatMap((env) => getEnvironmentPresets(env.id));
}
