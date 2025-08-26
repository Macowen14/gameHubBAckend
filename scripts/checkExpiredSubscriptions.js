import mongoose from "mongoose";
import Subscription from "../models/Subscription.js";
import dotenv from "dotenv";

dotenv.config();

const checkExpiredSubscriptions = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB for expiry check");

    const now = new Date();
    const result = await Subscription.updateMany(
      {
        status: "active",
        endDate: { $lte: now }
      },
      {
        $set: { status: "expired" }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} expired subscriptions`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Error checking expired subscriptions:", error);
    process.exit(1);
  }
};

checkExpiredSubscriptions();