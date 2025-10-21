const config = require('../config');

function cors(req, res, next) {
  if (!config.corsOrigin) {
    return next();
  }
  res.set('Access-Control-Allow-Origin', config.corsOrigin);
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,X-API-Key');
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }
  return next();
}

module.exports = cors;
