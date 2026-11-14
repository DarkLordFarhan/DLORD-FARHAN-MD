const assert = require('node:assert/strict');
const test = require('node:test');
const { createReconnectScheduler } = require('../lib/reconnect-scheduler');

function createFakeTimers() {
    const timers = [];
    return {
        timers,
        setTimeoutFn(callback, delayMs) {
            const timer = { callback, delayMs, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimeoutFn(timer) {
            timer.cleared = true;
        }
    };
}

async function runTimer(timer) {
    timer.callback();
    await new Promise(resolve => setImmediate(resolve));
}

test('reconnect scheduler allows only one pending retry and backs off to its cap', async () => {
    const fake = createFakeTimers();
    let reconnects = 0;
    const scheduler = createReconnectScheduler({
        reconnect: async () => { reconnects += 1; },
        logger: { warn() {}, error() {} },
        baseDelayMs: 5000,
        maxDelayMs: 60000,
        setTimeoutFn: fake.setTimeoutFn,
        clearTimeoutFn: fake.clearTimeoutFn
    });

    const expectedDelays = [5000, 10000, 20000, 40000, 60000, 60000];
    for (const delayMs of expectedDelays) {
        assert.equal(scheduler.schedule('test disconnect'), true);
        assert.equal(scheduler.schedule('duplicate close event'), false);
        const timer = fake.timers.at(-1);
        assert.equal(timer.delayMs, delayMs);
        assert.equal(scheduler.pending, true);
        await runTimer(timer);
        assert.equal(scheduler.pending, false);
    }
    assert.equal(reconnects, expectedDelays.length);
    assert.equal(scheduler.attempts, expectedDelays.length);
});

test('successful connection cancels pending retry and resets the backoff', () => {
    const fake = createFakeTimers();
    const scheduler = createReconnectScheduler({
        reconnect: async () => {},
        logger: { warn() {}, error() {} },
        setTimeoutFn: fake.setTimeoutFn,
        clearTimeoutFn: fake.clearTimeoutFn
    });

    scheduler.schedule('first disconnect');
    scheduler.schedule('second disconnect');
    const timer = fake.timers[0];
    assert.equal(timer.delayMs, 5000);
    scheduler.connected();
    assert.equal(timer.cleared, true);
    assert.equal(scheduler.pending, false);
    assert.equal(scheduler.attempts, 0);

    scheduler.schedule('later disconnect');
    assert.equal(fake.timers[1].delayMs, 5000);
});

test('stopping reconnect scheduler cancels its timer and prevents new retries', () => {
    const fake = createFakeTimers();
    const scheduler = createReconnectScheduler({
        reconnect: async () => {},
        logger: { warn() {}, error() {} },
        setTimeoutFn: fake.setTimeoutFn,
        clearTimeoutFn: fake.clearTimeoutFn
    });

    scheduler.schedule('disconnect');
    const timer = fake.timers[0];
    scheduler.stop();
    assert.equal(timer.cleared, true);
    assert.equal(scheduler.pending, false);
    assert.equal(scheduler.schedule('after stop'), false);
});
