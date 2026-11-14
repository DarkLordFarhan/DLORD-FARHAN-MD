function createReconnectScheduler({
    reconnect,
    logger = console,
    baseDelayMs = 5000,
    maxDelayMs = 60000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
} = {}) {
    if (typeof reconnect !== 'function') {
        throw new TypeError('reconnect must be a function');
    }
    if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
        throw new TypeError('baseDelayMs must be a non-negative number');
    }
    if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
        throw new TypeError('maxDelayMs must be a number greater than or equal to baseDelayMs');
    }

    let pendingTimer = null;
    let attempts = 0;
    let stopped = false;

    function schedule(reason = 'connection closed') {
        if (stopped || pendingTimer) return false;

        attempts += 1;
        const delayMs = Math.min(baseDelayMs * (2 ** (attempts - 1)), maxDelayMs);
        logger.warn?.(`[RECONNECT] ${reason}; retry ${attempts} scheduled in ${Math.ceil(delayMs / 1000)}s.`);

        pendingTimer = setTimeoutFn(() => {
            pendingTimer = null;
            Promise.resolve()
                .then(() => reconnect())
                .catch(error => {
                    logger.error?.('[RECONNECT] Retry attempt failed:', error?.stack || error);
                });
        }, delayMs);
        if (typeof pendingTimer?.unref === 'function') pendingTimer.unref();
        return true;
    }

    function connected() {
        attempts = 0;
        if (pendingTimer) clearTimeoutFn(pendingTimer);
        pendingTimer = null;
    }

    function stop() {
        stopped = true;
        connected();
    }

    return {
        schedule,
        connected,
        stop,
        get attempts() { return attempts; },
        get pending() { return pendingTimer !== null; }
    };
}

module.exports = { createReconnectScheduler };
