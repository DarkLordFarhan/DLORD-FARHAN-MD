function withTimeout(operation, timeoutMs = 8000, timeoutMessage = 'The operation timed out.') {
    const delay = Number.isFinite(Number(timeoutMs))
        ? Math.max(1, Math.min(30000, Math.floor(Number(timeoutMs))))
        : 8000;
    let timer;
    const task = Promise.resolve().then(() => (
        typeof operation === 'function' ? operation() : operation
    ));
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            const error = new Error(timeoutMessage);
            error.code = 'COMMAND_TIMEOUT';
            reject(error);
        }, delay);
    });

    return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}

function startLimitedOperation(registry, key, limit, operation, busyMessage = 'The service is busy.') {
    if (!key || (typeof key !== 'object' && typeof key !== 'function')) {
        throw new TypeError('A socket object is required for operation limiting.');
    }
    let active = registry.get(key);
    if (!active) {
        active = new Set();
        registry.set(key, active);
    }
    if (active.size >= limit) {
        const error = new Error(busyMessage);
        error.code = 'COMMAND_BUSY';
        throw error;
    }

    const task = Promise.resolve().then(operation);
    active.add(task);
    const release = () => active.delete(task);
    task.then(release, release);
    return task;
}

module.exports = { withTimeout, startLimitedOperation };
