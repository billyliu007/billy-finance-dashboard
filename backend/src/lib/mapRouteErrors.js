import { ApiError } from './ApiError.js';
import { getErrorMessage } from './requestHelpers.js';

export function rethrowAsCreateConflict(error) {
  if (error instanceof ApiError) throw error;
  const msg = getErrorMessage(error);
  throw new ApiError(msg, /already exists/i.test(msg) ? 409 : 400);
}

export function rethrowAsUpdateNotFound(error) {
  if (error instanceof ApiError) throw error;
  const msg = getErrorMessage(error);
  throw new ApiError(msg, /not found/i.test(msg) ? 404 : 400);
}

export function rethrowAsNotFound404(error) {
  if (error instanceof ApiError) throw error;
  throw new ApiError(getErrorMessage(error), 404);
}

export function rethrowAsNotFoundOr400(error) {
  if (error instanceof ApiError) throw error;
  const msg = getErrorMessage(error);
  throw new ApiError(msg, /not found/i.test(msg) ? 404 : 400);
}

export function rethrowAsBadRequest(error) {
  if (error instanceof ApiError) throw error;
  throw new ApiError(getErrorMessage(error), 400);
}

export function rethrowAsServerError(error) {
  if (error instanceof ApiError) throw error;
  throw new ApiError(getErrorMessage(error), 500);
}
