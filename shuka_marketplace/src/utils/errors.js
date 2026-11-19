class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message }
    });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: { code: 'FILE_TOO_LARGE', message: 'Image must be 5 MB or smaller.' }
    });
  }
  if (err && err.message === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      error: { code: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG, and WebP images are allowed.' }
    });
  }
  console.error(err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' }
  });
}

module.exports = { AppError, errorHandler };
