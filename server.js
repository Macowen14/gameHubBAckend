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

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "https://play-gym-hub.vercel.app",
  "http://localhost:5173",
  "https://gamehub-i770.onrender.com"
];

// Production vs Development CORS
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, health checks)
    if (!origin) {
      console.log('Allowing request with no origin (health check/internal)');
      return callback(null, true);
    }
    
    // In development, allow all origins for easier debugging
    if (process.env.NODE_ENV === 'development') {
      console.log('Development mode: Allowing origin:', origin);
      return callback(null, true);
    }
    
    // In production, check against allowed origins
    if (allowedOrigins.includes(origin)) {
      console.log('Production mode: Allowing whitelisted origin:', origin);
      return callback(null, true);
    }
    
    // For Render internal health checks, allow internal IPs
    if (origin.includes('10.') || origin.includes('127.0.0.1') || origin.includes('localhost')) {
      console.log('Allowing internal/local origin:', origin);
      return callback(null, true);
    }
    
    console.log('CORS blocked for origin:', origin);
    return callback(new Error('Not allowed by CORS'));
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
    'Pragma'
  ],
  exposedHeaders: [
    'Content-Length',
    'Content-Type',
    'Cache-Control'
  ],
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight requests

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

// Request logging middleware (only log in development or if LOG_REQUESTS is true)
if (process.env.NODE_ENV === 'development' || process.env.LOG_REQUESTS === 'true') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    console.log('Origin:', req.headers.origin || 'No origin');
    next();
  });
}

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
    version: process.env.npm_package_version || '1.0.0'
  };
  
  // Only include sensitive info in development
  if (process.env.NODE_ENV === 'development') {
    healthCheck.allowedOrigins = allowedOrigins;
  }
  
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
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  // Handle specific error types
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      error: "CORS policy violation",
      message: "Origin not allowed",
      yourOrigin: req.headers.origin || 'No origin provided',
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
        serverSelectionTimeoutMS: 10000, // Increased timeout
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        bufferCommands: false,
        bufferMaxEntries: 0
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
        // Don't fail the entire startup for background job errors
      }
      
      return true;
      
    } catch (error) {
      console.error(`❌ MongoDB connection failed (attempt ${attempt}/${retries}):`, error.message);
      
      if (attempt < retries) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 1.5; // Exponential backoff
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
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`✅ CORS configured for development (allowing all origins)`);
      } else {
        console.log(`🔒 CORS configured for production`);
      }
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
      
      // Stop accepting new connections
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
      
      // Force shutdown if graceful shutdown takes too long
      setTimeout(() => {
        console.error('⏰ Graceful shutdown timed out, forcing exit');
        process.exit(1);
      }, 30000);
    };

    // Register shutdown handlers
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // For nodemon

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