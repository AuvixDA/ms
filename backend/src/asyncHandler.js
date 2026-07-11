// Wraps an async Express handler so a rejected promise reaches the error middleware
// via next(err) instead of crashing the whole process as an unhandled rejection.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
