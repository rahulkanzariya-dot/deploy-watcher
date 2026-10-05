import { useRef, useState, useCallback, useEffect } from 'react';
import { parseResponsePayload, getValueByPath, flattenPayload } from '../utils/parser';
import { getDomain, requestNotifyPermission, fireLiveAlert } from '../utils/notify';
import { fetchWithFallback } from '../utils/fetcher';
import {
  getAllEnvironmentPresets,
  getEnvironmentPresets,
  detectEnvironmentFromUrl,
} from '../utils/presets';

const STORAGE_KEY = 'watchers-list';

function uid() {
  return 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function loadFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // fallback below
  }
  // Default to ALL environments (sbox, dev, lab, demo, prod) if nothing is stored in localStorage
  return getAllEnvironmentPresets();
}

function saveToStorage(watchers) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watchers));
  } catch (e) {
    console.error('Storage save failed', e);
  }
}

/**
 * Core hook managing watchers, automatically adapting to:
 * - Single-container environments (dev/local/staging)
 * - Multi-container environments behind load balancers (prod/scaled ECS)
 * - Static frontend builds on S3/CloudFront (with automatic CORS bypass)
 */
export function useWatchers(showToast) {
  const [watchers, setWatchers] = useState(() => loadFromStorage());

  const watchersRef = useRef(watchers);
  function setWatchersSync(updater) {
    setWatchers((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      watchersRef.current = next;
      return next;
    });
  }

  // Transient per-watcher runtime state (NOT persisted)
  const runtimeRef = useRef({});

  useEffect(() => {
    watchersRef.current.forEach((w) => {
      if (!runtimeRef.current[w.id]) {
        runtimeRef.current[w.id] = makeRuntime();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  function makeRuntime() {
    return {
      running: false,
      baseline: null,
      checkCount: 0,
      timerId: null,
      lastValue: null,
      completed: false,
      viaProxy: false,
      instances: {},       // { [instanceId]: { id, firstSeen, lastSeen, value } }
      baselinePool: [],    // known baseline values pool (handles multi-container start times)
      pendingDeploy: null, // { value, count, container }
      log: [],             // [{ time, msg, cls }]
      parsedLines: [],     // [{ key, value }]
      statusState: 'idle',
      statusMain: 'Idle',
      statusSub: 'click Start to begin watching',
    };
  }

  function getRT(id) {
    if (!runtimeRef.current[id]) {
      runtimeRef.current[id] = makeRuntime();
    }
    return runtimeRef.current[id];
  }

  function logFor(id, msg, cls = '') {
    const rt = getRT(id);
    rt.log.unshift({ time: new Date().toLocaleTimeString(), msg, cls });
    if (rt.log.length > 40) rt.log.pop();
  }

  function setStatus(id, state, main, sub) {
    const rt = getRT(id);
    rt.statusState = state;
    rt.statusMain = main;
    rt.statusSub = sub;
  }

  function completeDeploy(id, w, rt, oldVal, newVal, instanceId) {
    const instStr = instanceId ? ` [container: ${instanceId.slice(0, 8)}]` : '';
    logFor(id, `Deploy verified!${instStr} ${w.field}: "${oldVal}" → "${newVal}"`, 'ok');
    logFor(id, 'Watcher stopped automatically after deploy.', 'ok');
    fireLiveAlert(w, oldVal, newVal, showToast);
    rt.baseline = newVal;
    rt.baselinePool = [newVal];
    rt.pendingDeploy = null;
    rt.completed = true;
    stopWatcher(id);
    setStatus(id, 'live', 'Deployed ✅', `${w.field} changed: "${oldVal}" → "${newVal}" · watcher stopped`);
  }

  async function checkWatcher(id, watcherRef) {
    const w = watcherRef.current;
    if (!w) return;
    const rt = getRT(id);
    if (!rt.running) return;

    rt.checkCount++;
    try {
      const headers = {};
      if (w.authHeader) headers['Authorization'] = w.authHeader;

      // 1. Fetch with automatic CORS bypass
      const { text: rawText, viaProxy } = await fetchWithFallback(w.url, { headers });
      rt.viaProxy = viaProxy;

      // 2. Parse payload
      const parsedPayload = parseResponsePayload(rawText);
      rt.parsedLines = flattenPayload(parsedPayload);

      // Check if instance / container ID is present
      const rawInstance =
        parsedPayload.type === 'text'
          ? (parsedPayload.data.instance || parsedPayload.data.hostname || parsedPayload.data.host || parsedPayload.data.containerId || parsedPayload.data.container)
          : (parsedPayload.data?.instance || parsedPayload.data?.hostname || parsedPayload.data?.host || parsedPayload.data?.containerId || parsedPayload.data?.container);
      const instanceId = rawInstance ? String(rawInstance).trim() : null;

      // 3. Resolve tracked field value
      const value = getValueByPath(parsedPayload, w.field);
      if (value === undefined) {
        throw new Error(`Field "${w.field}" not found in response`);
      }

      const printableValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      rt.lastValue = printableValue;

      // 4. Register container instance if present
      if (instanceId) {
        if (!rt.instances[instanceId]) {
          rt.instances[instanceId] = {
            id: instanceId,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            value: printableValue,
          };
          const totalInstances = Object.keys(rt.instances).length;
          if (rt.checkCount <= 4) {
            logFor(
              id,
              `Discovered container [${instanceId.slice(0, 8)}] (${w.field}: "${printableValue}") — ${totalInstances} container${totalInstances > 1 ? 's' : ''} detected`,
              'ok'
            );
          }
        } else {
          rt.instances[instanceId].lastSeen = Date.now();
          rt.instances[instanceId].value = printableValue;
        }
      }

      const knownInstances = Object.keys(rt.instances);
      const isMultiContainer = knownInstances.length > 1;

      // Determine required confirmations:
      // In single-container environment: 1 confirmation is sufficient unless explicitly configured higher.
      // In multi-container environment: defaults to 2 to prevent premature alert while rolling updates finish.
      const defaultConf = isMultiContainer ? 2 : 1;
      const requiredConfirmations = Math.max(
        1,
        parseInt(w.confirmations, 10) || defaultConf
      );

      if (!rt.baselinePool) rt.baselinePool = [];

      // 5. Initial baseline capture (First check)
      if (rt.baselinePool.length === 0) {
        rt.baselinePool.push(printableValue);
        rt.baseline = printableValue;
        const containerNote = instanceId ? ` (container: ${instanceId.slice(0, 8)})` : '';
        logFor(id, `Baseline captured — ${w.field}: "${printableValue}"${containerNote}`, 'ok');
        setStatus(id, 'pending', 'Watching…', `Baseline "${w.field}" = "${printableValue}"${containerNote}`);
        rerender();
        return;
      }

      // 6. Discovery window (Checks 2-4):
      // If running in a multi-container environment where containers started at different times,
      // register alternate baseline values into the pool to prevent false alarms:
      if (
        w.multiInstance !== false &&
        rt.checkCount <= 4 &&
        !rt.baselinePool.includes(printableValue) &&
        rt.baselinePool.length < 5
      ) {
        rt.baselinePool.push(printableValue);
        logFor(
          id,
          `Multi-container pool expanded (#${rt.baselinePool.length}): "${printableValue}"${instanceId ? ` [${instanceId.slice(0, 8)}]` : ''}`,
          'ok'
        );
        setStatus(
          id,
          'pending',
          'Watching…',
          `${rt.baselinePool.length} containers in pool · ${w.field}: "${printableValue}"`
        );
        rerender();
        return;
      }

      // 7. Evaluation: Compare against baseline pool
      const isBaselineMatch = rt.baselinePool.includes(printableValue);

      if (isBaselineMatch) {
        // Value matches known baseline pool
        if (rt.pendingDeploy) {
          // If we previously saw a new deployment value, but now hit an old container:
          // Rolling deploy is currently in progress (traffic is split between old and new containers)!
          logFor(
            id,
            `Hit old baseline container (${w.field}: "${printableValue}") — waiting for remaining containers to update...`
          );
          setStatus(
            id,
            'pending',
            'Rolling deploy in progress…',
            `Old container still serving baseline ("${printableValue}"). Waiting for full rollout…`
          );
        } else {
          // Normal steady state
          const containerStr = isMultiContainer
            ? ` · ${knownInstances.length} containers active`
            : instanceId
            ? ` · container: ${instanceId.slice(0, 8)}`
            : '';
          logFor(id, `Check #${rt.checkCount}: no change (${w.field}: "${printableValue}")`);
          setStatus(
            id,
            'pending',
            'No change yet',
            `Last checked ${new Date().toLocaleTimeString()}${containerStr} · ${w.field}: "${printableValue}"`
          );
        }
      } else {
        // Value is NOT in baseline pool -> A NEW DEPLOYMENT HAS BEEN DETECTED!
        const containerStr = instanceId ? ` on [${instanceId.slice(0, 8)}]` : '';

        if (!rt.pendingDeploy || rt.pendingDeploy.value !== printableValue) {
          rt.pendingDeploy = { value: printableValue, count: 1, container: instanceId };
          logFor(
            id,
            `CHANGE DETECTED — ${w.field}: "${rt.baseline}" → "${printableValue}"${containerStr} (verification 1/${requiredConfirmations})`,
            'ok'
          );

          if (requiredConfirmations === 1) {
            completeDeploy(id, w, rt, rt.baseline, printableValue, instanceId);
          } else {
            setStatus(
              id,
              'pending',
              `Verifying Deploy (1/${requiredConfirmations})`,
              `New ${w.field}: "${printableValue}" detected${containerStr}. Verifying rollout…`
            );
          }
        } else {
          rt.pendingDeploy.count++;
          logFor(
            id,
            `Deploy confirmed (${rt.pendingDeploy.count}/${requiredConfirmations}): "${printableValue}"${containerStr}`,
            'ok'
          );

          if (rt.pendingDeploy.count >= requiredConfirmations) {
            completeDeploy(id, w, rt, rt.baseline, printableValue, instanceId);
          } else {
            setStatus(
              id,
              'pending',
              `Verifying Deploy (${rt.pendingDeploy.count}/${requiredConfirmations})`,
              `New ${w.field}: "${printableValue}" confirmed (${rt.pendingDeploy.count}/${requiredConfirmations})`
            );
          }
        }
      }
    } catch (err) {
      logFor(id, `ERROR — ${err.message}`, 'err');
      setStatus(id, 'error', 'Error', err.message);
    }

    rerender();
  }

  function startWatcher(id) {
    const watcher = watchersRef.current.find((w) => w.id === id);
    if (!watcher) return;
    const rt = getRT(id);
    if (rt.running) return;

    requestNotifyPermission();
    rt.running = true;
    rt.completed = false;
    rt.baseline = null;
    rt.baselinePool = [];
    rt.instances = {};
    rt.pendingDeploy = null;
    rt.viaProxy = false;
    rt.checkCount = 0;

    const watcherRef = { current: watcher };

    checkWatcher(id, watcherRef);
    rt.timerId = setInterval(() => checkWatcher(id, watcherRef), watcher.interval * 1000);
    rerender();
  }

  function stopWatcher(id) {
    const rt = getRT(id);
    if (rt.timerId) clearInterval(rt.timerId);
    rt.timerId = null;
    rt.running = false;
    rerender();
  }

  function startAll(targetIds) {
    const list = Array.isArray(targetIds)
      ? watchersRef.current.filter((w) => targetIds.includes(w.id))
      : watchersRef.current;
    list.forEach((w) => startWatcher(w.id));
  }

  function stopAll(targetIds) {
    const list = Array.isArray(targetIds)
      ? watchersRef.current.filter((w) => targetIds.includes(w.id))
      : watchersRef.current;
    list.forEach((w) => stopWatcher(w.id));
  }

  function addWatcher(data) {
    const id = uid();
    const env = data.environment || detectEnvironmentFromUrl(data.url);
    const newWatcher = { id, environment: env, ...data };
    runtimeRef.current[id] = makeRuntime();
    setWatchersSync((prev) => {
      const updated = [...prev, newWatcher];
      saveToStorage(updated);
      return updated;
    });
    showToast('✅ Watcher added');
  }

  function updateWatcher(id, data) {
    const rt = getRT(id);
    if (rt.running) stopWatcher(id);
    const env = data.environment || (data.url ? detectEnvironmentFromUrl(data.url) : undefined);
    setWatchersSync((prev) => {
      const updated = prev.map((w) =>
        w.id === id ? { ...w, ...(env ? { environment: env } : {}), ...data } : w
      );
      saveToStorage(updated);
      return updated;
    });
    showToast('✅ Watcher updated');
  }

  function changeField(id, newField) {
    const rt = getRT(id);
    const wasRunning = rt.running;
    if (wasRunning) stopWatcher(id);

    setWatchersSync((prev) => {
      const updated = prev.map((w) => (w.id === id ? { ...w, field: newField } : w));
      saveToStorage(updated);
      return updated;
    });

    showToast(`Tracking field changed to "${newField}"`);
    if (wasRunning) {
      setTimeout(() => startWatcher(id), 100);
    }
  }

  function deleteWatcher(id) {
    stopWatcher(id);
    delete runtimeRef.current[id];
    setWatchersSync((prev) => {
      const updated = prev.filter((w) => w.id !== id);
      saveToStorage(updated);
      return updated;
    });
  }

  function getRuntime(id) {
    return runtimeRef.current[id] || makeRuntime();
  }

  function loadEnvironment(env) {
    stopAll();
    const presets = getEnvironmentPresets(env);
    setWatchersSync(() => {
      saveToStorage(presets);
      return presets;
    });
    showToast(`Loaded ${env.toUpperCase()} environment presets`);
  }

  function resetToAllDefaults() {
    stopAll();
    const presets = getAllEnvironmentPresets();
    setWatchersSync(() => {
      saveToStorage(presets);
      return presets;
    });
    showToast('Reset to all environment presets (30 endpoints)');
  }

  return {
    watchers,
    getRuntime,
    getDomain,
    startWatcher,
    stopWatcher,
    startAll,
    stopAll,
    addWatcher,
    updateWatcher,
    changeField,
    loadEnvironment,
    resetToAllDefaults,
    deleteWatcher,
  };
}
