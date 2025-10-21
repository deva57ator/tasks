function format(message, level) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] ${message}`;
}

function log(level, message, meta) {
  if (meta && Object.keys(meta).length > 0) {
    console.log(format(`${message} ${JSON.stringify(meta)}`, level));
  } else {
    console.log(format(message, level));
  }
}

module.exports = {
  info(message, meta) {
    log('INFO', message, meta);
  },
  warn(message, meta) {
    log('WARN', message, meta);
  },
  error(message, meta) {
    if (meta instanceof Error) {
      console.error(format(`${message}: ${meta.message}`, 'ERROR'));
      if (meta.stack) {
        console.error(meta.stack);
      }
    } else {
      console.error(format(message, 'ERROR'));
      if (meta) {
        console.error(JSON.stringify(meta));
      }
    }
  }
};
