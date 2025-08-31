import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true, 
    index: true 
  },
  category: { 
    type: String, 
    enum: ["gaming", "gym", "movies", "sports"], 
    required: true 
  },
  plan: { 
    type: String, 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ["pending", "active", "expired", "failed", "cancelled"], 
    default: "pending" 
  },
  startDate: { 
    type: Date, 
    default: null 
  },
  endDate: { 
    type: Date, 
    required: true 
  },
  receiptNumber: { 
    type: String 
  },
  paidAmount: { 
    type: Number 
  },
  phoneNumber: { 
    type: String 
  },
  mpesaCheckoutId: {
    type: String,
    // REMOVED: index: true - This is the duplicate causing the error
  },
  mpesaTransactionDate: {
    type: String
  },
  failedReason: { 
    type: String 
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

subscriptionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  if (this.isModified('status') && this.status === 'active' && !this.startDate) {
    this.startDate = new Date();
  }
  
  next();
});

// Keep only the explicit index definitions
subscriptionSchema.index({ userId: 1, category: 1 });
subscriptionSchema.index({ status: 1, endDate: 1 });
subscriptionSchema.index({ createdAt: 1 });
subscriptionSchema.index({ mpesaCheckoutId: 1 }); // This is sufficient

subscriptionSchema.statics.findActive = function(userId, category) {
  return this.findOne({
    userId,
    category,
    status: 'active',
    endDate: { $gt: new Date() }
  });
};

subscriptionSchema.methods.isActive = function() {
  return this.status === 'active' && this.endDate > new Date();
};

export default mongoose.model("Subscription", subscriptionSchema);