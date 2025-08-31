import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import subscriptionRoutes from "./routes/subscription.js";
import { scheduleSubscriptionExpiryCheck } from "./scripts/expiryChecker.js";

dotenv.config();

const app = express();

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "https://play-gym-hub.vercel.app",
  "http://localhost:5173" // Add Vite dev server origin
];

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked for origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('Origin:', req.headers.origin);
  next();
});

// Routes
app.use("/api/subscriptions", subscriptionRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: "OK", 
    message: "Server is running",
    timestamp: new Date().toISOString(),
    allowedOrigins: allowedOrigins
  });
});

// Handle undefined routes
app.use("*", (req, res) => {
  console.warn(`[404] Route not found: ${req.originalUrl}`);
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      error: "CORS policy: Origin not allowed",
      allowedOrigins: allowedOrigins
    });
  }
  
  res.status(500).json({ 
    error: "Internal server error",
    referenceId: Date.now()
  });
});

// MongoDB connection with retry logic
const connectDB = async (retries = 5, delay = 5000) => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in environment variables");
    }
    
    console.log("Attempting MongoDB connection...");
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    console.log("✅ MongoDB connected successfully");
    
    // Start background jobs after successful DB connection
    scheduleSubscriptionExpiryCheck();
    
    return true;
  } catch (error) {
    console.error(`❌ MongoDB connection failed (${retries} retries left):`, error.message);
    
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return connectDB(retries - 1, delay);
    }
    
    return false;
  }
};

// Start server
const startServer = async () => {
  const dbConnected = await connectDB();
  
  if (!dbConnected) {
    console.log("❌ Server cannot start without database connection");
    process.exit(1);
  }
  
  const PORT = process.env.PORT || 5000;
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    console.log(`✅ Allowed origins:`, allowedOrigins);
  });

  // Handle graceful shutdown
  const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    
    server.close(async () => {
      console.log('HTTP server closed.');
      
      try {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed');
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    });
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
};

// Initialize server
startServer().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});