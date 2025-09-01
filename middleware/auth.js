// middleware/auth.js (updated)
import Logger from "../lib/logger.js";
const authLogger = new Logger('auth-middleware');

export function requireAuth(req, res, next) {
  const requestId = generateRequestId();
  const requestLogger = authLogger.withRequestId(requestId);
  
  const token = req.headers.authorization?.split(" ")[1];
  
  requestLogger.debug('Authentication attempt', {
    hasToken: !!token,
    path: req.path,
    method: req.method
  });

  if (!token) {
    requestLogger.warn('Authentication failed: No token provided');
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Verify Clerk token
    const decoded = jwt.verify(token, process.env.CLERK_JWT_KEY);
    req.user = decoded;
    
    requestLogger.debug('Authentication successful', {
      userId: req.user.sub,
      issuer: req.user.iss
    });
    
    next();
  } catch (err) {
    requestLogger.error('Authentication failed: Invalid token', {
      error: err.message,
      token: token.substring(0, 20) + '...' // Log partial token for debugging
    });
    
    // Check if token is expired
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: "Token expired" });
    }
    
    // Check if token is invalid
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: "Invalid token" });
    }
    
    return res.status(401).json({ error: "Authentication failed" });
  }
}