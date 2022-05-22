const requireFromApp = require('./require-from-app');

const PrettyError = requireFromApp('pretty-error');

let peInstance;

module.exports = function renderPrettyError(err) {
  if (peInstance) {
    return peInstance.render(err);
  }

  peInstance = new PrettyError();

  return peInstance.render(err);
};
