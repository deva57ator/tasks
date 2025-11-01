const rateLimit = require('express-rate-limit');
const config = require('../config');

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health' || req.path === '/health',
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests' } });
  }
});

module.exports = limiter;
