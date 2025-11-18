const workdays = require('./workdays');
const logger = require('../lib/logger');

const AUTO_CLOSE_INTERVAL_MS = 5 * 60 * 1000;

function start() {
  let running = false;
  let timer = null;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await workdays.getCurrent();
    } catch (err) {
      logger.error('workdayLifecycle.cycle_failed', { err });
    } finally {
      running = false;
    }
  };

  tick();
  timer = setInterval(tick, AUTO_CLOSE_INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = {
  start
};
