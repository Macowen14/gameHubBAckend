import mongoose from "mongoose";
import Subscription from "../models/Subscription.js";
import { schedule } from "node-cron";

export const checkExpiredSubscriptions = async () => {
  try {
    console.log("🔄 Checking for expired subscriptions...");
    
    const now = new Date();
    const result = await Subscription.updateMany(
      {
        status: "active",
        endDate: { $lte: now }
      },
      {
        $set: { 
          status: "expired",
          updatedAt: now
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Updated ${result.modifiedCount} expired subscriptions`);
    } else {
      console.log("✅ No expired subscriptions found");
    }
    
    return result.modifiedCount;
  } catch (error) {
    console.error("❌ Error checking expired subscriptions:", error);
    throw error;
  }
};

export const scheduleSubscriptionExpiryCheck = () => {
  schedule('0 2 * * *', async () => {
    try {
      await checkExpiredSubscriptions();
    } catch (error) {
      console.error("Scheduled expiry check failed:", error);
    }
  });
  
  console.log("✅ Subscription expiry checker scheduled");
};