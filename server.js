import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import subscriptionRoutes from "./routes/subscription.js";
import { scheduleSubscriptionExpiryCheck } from "./scripts/expiryChecker.js";

dotenv.config();

const app = express();

// Environment validation
const requiredEnvVars = ['MONGO_URI'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// CORS configuration - FIXED
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "https://play-gym-hub.vercel.app",
  "http://localhost:5173",
  "https://gamehub-i770.onrender.com",
  // Add more flexible patterns for development
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,  // Private network IPs
  /^http:\/\/192\.168\.\d+\.\d+:\d+$/  // Local network IPs
];

// Improved CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    console.log('🔍 CORS check for origin:', origin);
    
    // Allow requests with no origin (mobile apps, Postman, curl, health checks)
    if (!origin) {
      console.log('✅ Allowing request with no origin (direct request)');
      return callback(null, true);
    }
    
    // In development, be more permissive
    if (process.env.NODE_ENV === 'development') {
      console.log('✅ Development mode: Allowing origin:', origin);
      return callback(null, true);
    }
    
    // Check against allowed origins (both strings and regex patterns)
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return allowedOrigin === origin;
      } else if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      console.log('✅ Origin allowed:', origin);
      return callback(null, true);
    }
    
    console.log('❌ CORS blocked for origin:', origin);
    console.log('📝 Allowed origins:', allowedOrigins);
    
    // For debugging, don't block in development-like environments
    const isDevelopmentLike = origin.includes('localhost') || 
                              origin.includes('127.0.0.1') || 
                              origin.match(/10\.\d+\.\d+\.\d+/) ||
                              origin.match(/192\.168\.\d+\.\d+/);
    
    if (isDevelopmentLike) {
      console.log('🔧 Development-like origin, allowing:', origin);
      return callback(null, true);
    }
    
    return callback(new Error(`CORS blocked: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Accept',
    'Origin',
    'X-Requested-With',
    'Cache-Control',
    'Pragma',
    'Access-Control-Allow-Headers',
    'Access-Control-Allow-Methods',
    'Access-Control-Allow-Origin'
  ],
  exposedHeaders: [
    'Content-Length',
    'Content-Type',
    'Cache-Control'
  ],
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200,
  preflightContinue: false
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Explicitly handle preflight requests
app.use((req, res, next) => {
  // Log all requests for debugging
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.headers.origin || 'no origin'}`);
  
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    console.log('🔧 Handling OPTIONS preflight request');
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cache-Control, Pragma');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    return res.status(200).end();
  }
  
  next();
});

// Body parsing middleware with size limits
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      throw new Error('Invalid JSON');
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Routes
app.use("/api/subscriptions", subscriptionRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  const healthCheck = {
    status: "OK",
    message: "Server is running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    cors: {
      origin: req.headers.origin || 'no origin',
      allowedOrigins: allowedOrigins.map(origin => 
        origin instanceof RegExp ? origin.toString() : origin
      )
    }
  };
  
  res.status(200).json(healthCheck);
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "GameHub API Server",
    status: "Running",
    version: process.env.npm_package_version || '1.0.0',
    endpoints: {
      health: "/health",
      subscriptions: "/api/subscriptions"
    },
    cors: {
      requestOrigin: req.headers.origin || 'no origin',
      timestamp: new Date().toISOString()
    }
  });
});

// Handle undefined routes
app.use("*", (req, res) => {
  console.warn(`[404] Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: "Route not found",
    message: `Cannot ${req.method} ${req.originalUrl}`,
    availableEndpoints: {
      health: "/health",
      subscriptions: "/api/subscriptions"
    }
  });
});

// Global error handler
app.use((err, req, res, next) => {
  const errorId = Date.now().toString(36);
  
  console.error(`[ERROR ${errorId}]`, {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    origin: req.headers.origin,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  // Handle specific error types
  if (err.message.includes('CORS blocked') || err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      error: "CORS policy violation",
      message: err.message,
      yourOrigin: req.headers.origin || 'No origin provided',
      allowedOrigins: allowedOrigins.map(origin => 
        origin instanceof RegExp ? origin.toString() : origin
      ),
      errorId
    });
  }
  
  if (err.message === 'Invalid JSON') {
    return res.status(400).json({
      error: "Bad Request",
      message: "Invalid JSON in request body",
      errorId
    });
  }
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: "Validation Error",
      message: err.message,
      errorId
    });
  }
  
  // Generic error response
  res.status(err.status || 500).json({ 
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' ? err.message : "Something went wrong",
    errorId
  });
});

// MongoDB connection with improved error handling and retry logic
const connectDB = async (retries = 5, delay = 5000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Attempting MongoDB connection (attempt ${attempt}/${retries})...`);
      
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000, // Keep trying to send operations for 10 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
        maxPoolSize: 10, // Maintain up to 10 socket connections
        minPoolSize: 5, // Maintain at least 5 socket connections
        bufferCommands: false, // Disable mongoose buffering
        maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
        family: 4 // Use IPv4, skip trying IPv6
      });
            
      console.log("✅ MongoDB connected successfully");
      
      // Set up mongoose connection event listeners
      mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
      });
      
      mongoose.connection.on('disconnected', () => {
        console.warn('📡 MongoDB disconnected');
      });
      
      mongoose.connection.on('reconnected', () => {
        console.log('🔄 MongoDB reconnected');
      });
      
      // Start background jobs after successful DB connection
      try {
        scheduleSubscriptionExpiryCheck();
        console.log("✅ Background jobs scheduled");
      } catch (jobError) {
        console.error('⚠️ Failed to start background jobs:', jobError.message);
      }
      
      return true;
      
    } catch (error) {
      console.error(`❌ MongoDB connection failed (attempt ${attempt}/${retries}):`, error.message);
      
      if (attempt < retries) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 1.5;
      }
    }
  }
  
  return false;
};

// Start server with proper error handling
const startServer = async () => {
  try {
    const dbConnected = await connectDB();
    
    if (!dbConnected) {
      console.error("❌ Server cannot start without database connection");
      process.exit(1);
    }
    
    const PORT = process.env.PORT || 5000;
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔍 Health check: http://localhost:${PORT}/health`);
      console.log(`🔒 CORS configured with allowed origins:`, allowedOrigins);
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        process.exit(1);
      }
      console.error('Server error:', error);
    });

    // Graceful shutdown handler
    const gracefulShutdown = async (signal) => {
      console.log(`\n📡 ${signal} received. Initiating graceful shutdown...`);
      
      server.close(async () => {
        console.log('🔄 HTTP server closed');
        
        try {
          await mongoose.connection.close();
          console.log('✅ MongoDB connection closed');
          console.log('👋 Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          console.error('❌ Error during shutdown:', error);
          process.exit(1);
        }
      });
      
      setTimeout(() => {
        console.error('⏰ Graceful shutdown timed out, forcing exit');
        process.exit(1);
      }, 30000);
    };

    // Register shutdown handlers
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('UNHANDLED_REJECTION');
    });
    
  } catch (error) {
    console.error("💥 Failed to start server:", error);
    process.exit(1);
  }
};

// Initialize server
startServer();