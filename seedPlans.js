import mongoose from "mongoose";
import dotenv from "dotenv";
import Plan from "./models/Plans.js";

dotenv.config();

const seedPlans = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const plans = [
      // Gaming plans
      {
        category: "gaming",
        plan: "Hourly Pass",
        amount: 50,
        durationHours: 1,
        durationDays: null,
        description: "Play games for 1 hour"
      },
      {
        category: "gaming",
        plan: "Daily Pass",
        amount: 300,
        durationHours: null,
        durationDays: 1,
        description: "Unlimited gaming for 24 hours"
      },
      {
        category: "gaming",
        plan: "Weekly Pass",
        amount: 1500,
        durationHours: null,
        durationDays: 7,
        description: "Unlimited gaming for 1 week"
      },
      {
        category: "gaming",
        plan: "Monthly Pass",
        amount: 5000,
        durationHours: null,
        durationDays: 30,
        description: "Unlimited gaming for 1 month"
      },
      
      // Gym plans
      {
        category: "gym",
        plan: "Daily Workout",
        amount: 200,
        durationHours: null,
        durationDays: 1,
        description: "Access to gym for 1 day"
      },
      {
        category: "gym",
        plan: "Weekly Membership",
        amount: 1000,
        durationHours: null,
        durationDays: 7,
        description: "Full gym access for 1 week"
      },
      {
        category: "gym",
        plan: "Monthly Membership",
        amount: 3500,
        durationHours: null,
        durationDays: 30,
        description: "Full gym access for 1 month"
      },
      {
        category: "gym",
        plan: "Annual Membership",
        amount: 30000,
        durationHours: null,
        durationDays: 365,
        description: "Full gym access for 1 year"
      },
      
      // Additional example plans
      {
        category: "movies",
        plan: "Basic",
        amount: 100,
        durationHours: null,
        durationDays: 1,
        description: "Access to standard movies for 1 day"
      },
      {
        category: "movies",
        plan: "Premium",
        amount: 300,
        durationHours: null,
        durationDays: 7,
        description: "Access to all movies for 1 week"
      },
      {
        category: "sports",
        plan: "Daily Pass",
        amount: 50,
        durationHours: 24,
        durationDays: null,
        description: "Access to sports facilities for 24 hours"
      },
      {
        category: "sports",
        plan: "Monthly Pass",
        amount: 1000,
        durationHours: null,
        durationDays: 30,
        description: "Access to sports facilities for 1 month"
      }
    ];

    await Plan.deleteMany({});
    console.log("✅ Cleared existing plans");
    
    await Plan.insertMany(plans);
    console.log("✅ Plans seeded successfully!");
    
    // Display the seeded plans
    const gamingPlans = await Plan.find({ category: "gaming" });
    const gymPlans = await Plan.find({ category: "gym" });
    
    console.log("\n📊 Gaming Plans:");
    gamingPlans.forEach(p => {
      console.log(`   ${p.plan}: ₹${p.amount} - ${p.description}`);
    });
    
    console.log("\n📊 Gym Plans:");
    gymPlans.forEach(p => {
      console.log(`   ${p.plan}: ₹${p.amount} - ${p.description}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding plans:", error);
    process.exit(1);
  }
};

seedPlans();