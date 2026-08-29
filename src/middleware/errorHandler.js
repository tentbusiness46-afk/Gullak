// Catches anything thrown/rejected inside an async route handler (via
// the asyncRoute wrapper below) and turns it into a clean JSON error
// instead of an unhandled crash.
function asyncRoute(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Express recognises this as an error handler because it takes 4 args.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.publicMessage || 'Something went wrong. Please try again.'
  });
}

module.exports = { asyncRoute, errorHandler };
