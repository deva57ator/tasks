const { ValidationError } = require('../lib/errors');

function validate(schema, property = 'body', { assignTo } = {}) {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse(req[property] ?? {});
      if (assignTo) {
        req[assignTo] = parsed;
      } else {
        req[property] = parsed;
      }
      next();
    } catch (err) {
      if (err?.issues) {
        next(new ValidationError(err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))));
      } else {
        next(new ValidationError([{ message: 'Invalid request payload' }]));
      }
    }
  };
}

module.exports = validate;
