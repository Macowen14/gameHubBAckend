import mongoose from "mongoose";

const planSchema = new mongoose.Schema(
  {
    category: { 
      type: String, 
      required: true, 
      enum: ["gaming", "gym", "movies", "sports"] 
    },
    plan: { type: String, required: true },
    amount: { type: Number, required: true },
    durationHours: { type: Number, default: null },
    durationDays: { type: Number, default: null },
    description: { type: String, required: true }
  },
  { timestamps: true }
);

export default mongoose.model("Plan", planSchema);