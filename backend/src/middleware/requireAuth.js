/**
 * Require an authenticated user. Use after the session resolution middleware.
 */
export function requireAuth(req, res, next) {
  if (!req.auth?.user?.userId) {
    return res.status(401).json({ message: 'Authentication required.' });
  }
  return next();
}
