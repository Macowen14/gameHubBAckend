import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // Clerk user ID
  category: { type: String, enum: ["gaming", "gym", "movies", "sports"], required: true },
  plan: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ["pending", "active", "expired", "failed"], default: "pending" },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },
  receiptNumber: { type: String },
  paidAmount: { type: Number },
  phoneNumber: { type: String },
  failedReason: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field before saving
subscriptionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Add index for better query performance
subscriptionSchema.index({ userId: 1, category: 1 });
subscriptionSchema.index({ status: 1, endDate: 1 });

export default mongoose.model("Subscription", subscriptionSchema);