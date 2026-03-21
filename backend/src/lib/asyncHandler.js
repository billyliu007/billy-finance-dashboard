/**
 * Wraps an async Express route handler so rejections and thrown errors are passed to `next(err)`.
 * Use with the global error middleware in `app.js` (reads `err.statusCode` from {@link ApiError}).
 *
 * @template {import('express').Request} Req
 * @template {import('express').Response} Res
 * @param {(req: Req, res: Res, next: import('express').NextFunction) => unknown | Promise<unknown>} fn
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
