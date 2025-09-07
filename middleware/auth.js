// middleware/auth.js
import { jwtVerify, createRemoteJWKSet } from "jose";
import Logger from "../lib/logger.js";

const authLogger = new Logger("auth-middleware");

// Generate requestId for logs
function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// Clerk JWKS endpoint (replace with your actual instance)
const JWKS = createRemoteJWKSet(
  new URL("https://unified-seasnail-57.clerk.accounts.dev/.well-known/jwks.json")
);

export async function requireAuth(req, res, next) {
  const requestId = generateRequestId();
  const requestLogger = authLogger.withRequestId(requestId);

  const token = req.headers.authorization?.split(" ")[1];

  requestLogger.debug("Authentication attempt", {
    hasToken: !!token,
    path: req.path,
    method: req.method,
  });

  if (!token) {
    requestLogger.warn("Authentication failed: No token provided");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Verify Clerk token
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: "https://unified-seasnail-57.clerk.accounts.dev",
    });

    req.user = payload;

    requestLogger.debug("Authentication successful", {
      userId: req.user.sub,
      issuer: req.user.iss,
    });

    next();
  } catch (err) {
    requestLogger.error("Authentication failed: Invalid token", {
      error: err.message,
      token: token.substring(0, 20) + "...",
    });

    return res.status(401).json({ error: "Authentication failed" });
  }
}
