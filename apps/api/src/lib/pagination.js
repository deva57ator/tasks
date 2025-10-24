function parseLimit(value, defaultValue = 50, max = 200) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) return defaultValue;
  return Math.min(num, max);
}

function parseOffset(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

module.exports = {
  parseLimit,
  parseOffset
};
