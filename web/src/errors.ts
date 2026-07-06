import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // Errors that carry an HTTP client-error status (e.g. body-parser's
  // malformed-JSON SyntaxError has status 400 / type "entity.parse.failed").
  const status =
    typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : undefined;
  if (status !== undefined && status >= 400 && status < 500) {
    const isParse = (err as { type?: unknown }).type === "entity.parse.failed";
    res.status(status).json({
      error: {
        code: isParse ? "invalid_json" : "bad_request",
        message: isParse ? "Malformed JSON in request body" : (err as Error).message,
      },
    });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal", message: "Internal server error" } });
};
