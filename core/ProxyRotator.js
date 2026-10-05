// core/ProxyRotator.js
// Round-robin proxy rotator con tracciamento della salute.
//  - I proxy falliti vengono esclusi temporaneamente e riprovati dopo un timeout
//  - Il carico viene distribuito in modo uniforme tra i proxy sani
import { logger } from '../utils/logger.js';

const DEFAULT_RETRY_TIMEOUT_MS = 60 * 1000;
const DEFAULT_LOG_EVERY = 1000;

export default class ProxyRotator {
  /**
   * @param {string[]} proxies lista iniziale di proxy (es. "1.2.3.4:8080")
   * @param {{retryTimeout?: number, logEvery?: number}} options
   */
  constructor(proxies = [], options = {}) {
    this.retryTimeout = options.retryTimeout ?? DEFAULT_RETRY_TIMEOUT_MS;
    this.logEvery = options.logEvery ?? DEFAULT_LOG_EVERY;
    this.entries = new Map(); // proxy -> stato
    this.order = []; // ordine di rotazione
    this.cursor = 0;
    this.totalRotations = 0;
    this.totalFailures = 0;
    this.totalRecoveries = 0;
    this.setProxies(proxies);
  }

  _normalize(proxy) {
    return typeof proxy === 'string' ? proxy.trim() : '';
  }

  _createEntry() {
    return {
      failed: false,
      failedAt: null,
      retryAt: null,
      timer: null,
      uses: 0,
      failures: 0,
      successes: 0,
    };
  }

  /**
   * Sostituisce la lista di proxy mantenendo lo stato dei proxy già noti.
   */
  setProxies(proxies = []) {
    const next = [...new Set(proxies.map((p) => this._normalize(p)).filter(Boolean))];
    const nextSet = new Set(next);

    for (const [proxy, entry] of this.entries) {
      if (!nextSet.has(proxy)) {
        if (entry.timer) clearTimeout(entry.timer);
        this.entries.delete(proxy);
      }
    }
    for (const proxy of next) {
      if (!this.entries.has(proxy)) this.entries.set(proxy, this._createEntry());
    }

    this.order = next;
    this.cursor = this.order.length ? this.cursor % this.order.length : 0;
  }

  _isHealthy(proxy) {
    const entry = this.entries.get(proxy);
    if (!entry) return false;
    if (entry.failed && entry.retryAt !== null && Date.now() >= entry.retryAt) {
      this.resetFailedProxy(proxy);
    }
    return !entry.failed;
  }

  /**
   * Restituisce solo i proxy attualmente sani.
   */
  getHealthyProxies() {
    return this.order.filter((proxy) => this._isHealthy(proxy));
  }

  /**
   * Restituisce i proxy attualmente esclusi.
   */
  getFailedProxies() {
    return this.order.filter((proxy) => !this._isHealthy(proxy));
  }

  /**
   * Prossimo proxy in rotazione round-robin tra quelli sani.
   * Se tutti sono falliti, vengono ripristinati per evitare di restare senza proxy.
   * @returns {string|null}
   */
  getNextProxy() {
    const total = this.order.length;
    if (total === 0) return null;

    let proxy = this._pickHealthy();
    if (proxy === null) {
      logger.warn('All proxies are marked as failed, resetting them', 'ProxyRotator');
      for (const p of this.order) this.resetFailedProxy(p);
      proxy = this._pickHealthy();
    }
    if (proxy === null) return null;

    this.entries.get(proxy).uses++;
    this.totalRotations++;
    if (this.logEvery > 0 && this.totalRotations % this.logEvery === 0) this.logStats();
    return proxy;
  }

  _pickHealthy() {
    const total = this.order.length;
    for (let i = 0; i < total; i++) {
      const idx = (this.cursor + i) % total;
      const proxy = this.order[idx];
      if (this._isHealthy(proxy)) {
        this.cursor = (idx + 1) % total;
        return proxy;
      }
    }
    return null;
  }

  /**
   * Marca un proxy come fallito ed lo esclude finché non scade il timeout.
   */
  markProxyAsFailed(proxy) {
    proxy = this._normalize(proxy);
    const entry = this.entries.get(proxy);
    if (!entry) return;

    entry.failures++;
    this.totalFailures++;
    if (entry.failed) return;

    entry.failed = true;
    entry.failedAt = Date.now();
    entry.retryAt = entry.failedAt + this.retryTimeout;
    entry.timer = setTimeout(() => this.resetFailedProxy(proxy), this.retryTimeout);
    entry.timer.unref?.();
    logger.warn(`Proxy ${proxy} marked as failed, retry in ${Math.round(this.retryTimeout / 1000)}s`, 'ProxyRotator');
  }

  /**
   * Segnala una connessione riuscita (utile per le statistiche).
   */
  markProxyAsSuccessful(proxy) {
    const entry = this.entries.get(this._normalize(proxy));
    if (entry) entry.successes++;
  }

  /**
   * Riabilita un proxy fallito in modo che venga riprovato.
   */
  resetFailedProxy(proxy) {
    proxy = this._normalize(proxy);
    const entry = this.entries.get(proxy);
    if (!entry || !entry.failed) return;

    if (entry.timer) clearTimeout(entry.timer);
    entry.failed = false;
    entry.failedAt = null;
    entry.retryAt = null;
    entry.timer = null;
    this.totalRecoveries++;
    logger.info(`Proxy ${proxy} re-enabled for retry`, 'ProxyRotator');
  }

  getStats() {
    const healthy = this.getHealthyProxies();
    const failed = this.getFailedProxies();
    const now = Date.now();
    return {
      total: this.order.length,
      healthy: healthy.length,
      failed: failed.length,
      totalRotations: this.totalRotations,
      totalFailures: this.totalFailures,
      totalRecoveries: this.totalRecoveries,
      retryTimeoutMs: this.retryTimeout,
      failedProxies: failed.map((proxy) => {
        const entry = this.entries.get(proxy);
        return {
          proxy,
          failures: entry.failures,
          retryInMs: Math.max(0, (entry.retryAt ?? now) - now),
        };
      }),
      usage: {
        // distribuzione del carico: usi per proxy (max 20 più usati)
        topProxies: this.order
          .map((proxy) => ({ proxy, ...this._usage(proxy) }))
          .sort((a, b) => b.uses - a.uses)
          .slice(0, 20),
      },
    };
  }

  _usage(proxy) {
    const { uses, failures, successes } = this.entries.get(proxy);
    return { uses, failures, successes };
  }

  logStats() {
    const s = this.getStats();
    logger.info(
      `rotations=${s.totalRotations} healthy=${s.healthy}/${s.total} failed=${s.failed} recoveries=${s.totalRecoveries}`,
      'ProxyRotator',
    );
  }

  destroy() {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
  }
}
