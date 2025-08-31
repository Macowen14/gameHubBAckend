import express from "express";
import Subscription from "../models/Subscription.js";
import Plan from "../models/Plans.js"; 
import { requireAuth } from "../middleware/auth.js";
import { initiateStkPush, queryTransactionStatus } from "../lib/mpesa.js";

const router = express.Router();

// Request logging middleware
router.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] [Subscription] ${req.method} ${req.path}`);
  next();
});

/**
 * Get all available plans (public)
 */
router.get("/plans", async (req, res) => {
  try {
    console.log("Fetching all plans...");
    const plans = await Plan.find().lean();
    
    if (!plans || plans.length === 0) {
      console.warn("No plans found in database");
      return res.status(404).json({ error: "No plans found" });
    }
    
    console.log(`Found ${plans.length} plans`);
    res.json(plans); // Return array directly for frontend compatibility
  } catch (err) {
    console.error("Error fetching plans:", err.message);
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

/**
 * Get plans by category
 */
router.get("/plans/:category", async (req, res) => {
  try {
    const { category } = req.params;
    console.log(`Fetching ${category} plans...`);
    
    const plans = await Plan.find({ category }).lean();
    
    if (!plans || plans.length === 0) {
      console.warn(`No ${category} plans found`);
      return res.status(404).json({ error: `No ${category} plans found` });
    }
    
    console.log(`Found ${plans.length} ${category} plans`);
    res.json(plans); // Return array directly
  } catch (err) {
    console.error(`Error fetching ${category} plans:`, err.message);
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

/**
 * Subscribe + Pay with M-Pesa
 */
router.post("/subscribe", requireAuth, async (req, res) => {
  try {
    const { category, plan: planName, phone } = req.body;

    // Validate input
    if (!category || !planName || !phone) {
      console.warn("Missing required fields:", { category, planName, phone });
      return res.status(400).json({ 
        error: "Missing required fields: category, plan, or phone" 
      });
    }

    console.log("Subscription request received:", { 
      userId: req.user.sub, 
      category, 
      planName, 
      phone 
    });

    // Fetch plan from DB
    const chosenPlan = await Plan.findOne({ category, plan: planName }).lean();
    if (!chosenPlan) {
      console.warn("Invalid plan requested:", { category, planName });
      return res.status(400).json({ error: "Invalid category or plan" });
    }

    // Check if user already has an active subscription for this category
    const existingActiveSub = await Subscription.findOne({
      userId: req.user.sub,
      category,
      status: "active",
      endDate: { $gt: new Date() }
    });

    if (existingActiveSub) {
      console.warn("User already has active subscription:", { 
        userId: req.user.sub, 
        category,
        existingSub: existingActiveSub._id 
      });
      return res.status(400).json({ 
        error: `You already have an active ${category} subscription` 
      });
    }

    // Compute endDate
    let endDate = new Date();
    if (chosenPlan.durationHours) {
      endDate.setHours(endDate.getHours() + chosenPlan.durationHours);
    } else if (chosenPlan.durationDays) {
      endDate.setDate(endDate.getDate() + chosenPlan.durationDays);
    } else {
      // Default to 30 days if no duration specified
      endDate.setDate(endDate.getDate() + 30);
    }

    // Create subscription
    const subscription = new Subscription({
      userId: req.user.sub,
      category,
      plan: chosenPlan.plan,
      amount: chosenPlan.amount,
      endDate,
      status: "pending",
    });

    await subscription.save();
    console.log("Pending subscription saved:", subscription._id);

    // Trigger STK Push
    const mpesaResp = await initiateStkPush({
      phone: phone,
      amount: chosenPlan.amount,
      accountRef: subscription._id.toString(),
      transactionDesc: `${category} subscription - ${chosenPlan.plan}`
    });

    // Update subscription with M-Pesa reference
    subscription.mpesaCheckoutId = mpesaResp.checkoutRequestId;
    await subscription.save();

    res.status(201).json({
      success: true,
      message: "STK Push initiated. Enter M-Pesa PIN to complete.",
      data: {
        subscription: {
          id: subscription._id,
          category: subscription.category,
          plan: subscription.plan,
          amount: subscription.amount,
          endDate: subscription.endDate,
          status: subscription.status
        },
        mpesa: mpesaResp.data,
      }
    });
  } catch (err) {
    console.error("Subscription error:", {
      error: err.message,
      userId: req.user?.sub,
      body: req.body
    });
    
    // Provide more specific error messages
    let statusCode = 500;
    let errorMessage = err.message;
    
    if (err.message.includes("Invalid phone number")) {
      statusCode = 400;
    } else if (err.message.includes("M-Pesa credentials")) {
      statusCode = 503;
      errorMessage = "Payment service temporarily unavailable";
    }
    
    res.status(statusCode).json({ error: errorMessage });
  }
});

/**
 * M-Pesa callback (Safaricom will POST here)
 */
router.post("/mpesa/callback", async (req, res) => {
  try {
    console.log("M-Pesa callback received:", JSON.stringify(req.body, null, 2));

    if (!req.body.Body || !req.body.Body.stkCallback) {
      console.error("Invalid callback format:", req.body);
      return res.status(400).json({ ResultCode: 1, ResultDesc: "Invalid callback format" });
    }

    const { Body } = req.body;
    const { 
      MerchantRequestID, 
      CheckoutRequestID, 
      ResultCode, 
      CallbackMetadata, 
      ResultDesc 
    } = Body.stkCallback;

    console.log("Processing callback:", {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc
    });

    let subscriptionUpdate;
    
    if (parseInt(ResultCode) === 0) {
      // Success case
      const metadata = CallbackMetadata?.Item || [];
      const receiptItem = metadata.find(i => i.Name === "MpesaReceiptNumber");
      const amountItem = metadata.find(i => i.Name === "Amount");
      const accountRefItem = metadata.find(i => i.Name === "AccountReference");
      const phoneItem = metadata.find(i => i.Name === "PhoneNumber");
      const dateItem = metadata.find(i => i.Name === "TransactionDate");

      if (!receiptItem || !amountItem || !accountRefItem) {
        console.error("Missing required metadata in callback:", metadata);
        return res.status(400).json({ ResultCode: 1, ResultDesc: "Missing metadata" });
      }

      const receipt = receiptItem.Value;
      const amount = amountItem.Value;
      const accountRef = accountRefItem.Value;
      const phone = phoneItem ? phoneItem.Value : null;
      const transactionDate = dateItem ? dateItem.Value : null;

      // Update subscription to active
      subscriptionUpdate = {
        status: "active",
        receiptNumber: receipt,
        paidAmount: amount,
        phoneNumber: phone,
        mpesaTransactionDate: transactionDate,
        startDate: new Date(),
        updatedAt: new Date()
      };

      console.log("Payment successful, updating subscription:", accountRef);

    } else {
      // Failure case
      subscriptionUpdate = {
        status: "failed",
        failedReason: ResultDesc,
        updatedAt: new Date()
      };
      
      console.log("Payment failed:", ResultDesc);
    }

    // Find and update subscription by CheckoutRequestID or AccountReference
    let subscription;
    if (CheckoutRequestID) {
      subscription = await Subscription.findOneAndUpdate(
        { mpesaCheckoutId: CheckoutRequestID },
        subscriptionUpdate,
        { new: true }
      );
    }

    // Fallback: Try to find by ID if not found by CheckoutRequestID
    if (!subscription && Body.stkCallback.CheckoutRequestID) {
      const accountRef = Body.stkCallback.CheckoutRequestID;
      subscription = await Subscription.findByIdAndUpdate(
        accountRef,
        subscriptionUpdate,
        { new: true }
      );
    }

    if (!subscription) {
      console.error("Subscription not found for callback:", {
        CheckoutRequestID,
        MerchantRequestID
      });
      // Still respond successfully to M-Pesa to prevent retries
    } else {
      console.log("Subscription updated successfully:", subscription._id);
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("Callback processing error:", err.message);
    // Still respond successfully to prevent M-Pesa retries
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

/**
 * Check payment status
 */
router.get("/:id/status", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const subscription = await Subscription.findOne({ 
      _id: id, 
      userId: req.user.sub 
    });
    
    if (!subscription) {
      return res.status(404).json({ error: "Subscription not found" });
    }
    
    // If pending and has M-Pesa checkout ID, query status
    if (subscription.status === "pending" && subscription.mpesaCheckoutId) {
      try {
        const status = await queryTransactionStatus(subscription.mpesaCheckoutId);
        console.log("M-Pesa query result:", status);
        
        // Update subscription based on query result
        if (status.ResultCode === "0") {
          subscription.status = "active";
          await subscription.save();
        }
      } catch (queryError) {
        console.error("Error querying transaction status:", queryError.message);
      }
    }
    
    res.json({ 
      success: true, 
      data: {
        status: subscription.status,
        receiptNumber: subscription.receiptNumber,
        updatedAt: subscription.updatedAt
      }
    });
  } catch (err) {
    console.error("Status check error:", err.message);
    res.status(500).json({ error: "Failed to check status" });
  }
});

/**
 * Get user's subscriptions
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const { category, status } = req.query;
    let query = { userId: req.user.sub };
    
    if (category) query.category = category;
    if (status) query.status = status;
    
    const subs = await Subscription.find(query).sort({ createdAt: -1 });
    
    res.json(subs); // Return array directly
  } catch (err) {
    console.error("Fetch subscriptions error:", err.message);
    res.status(500).json({ error: "Failed to fetch subscriptions" });
  }
});

/**
 * Get subscription by ID
 */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const subscription = await Subscription.findOne({ 
      _id: id, 
      userId: req.user.sub 
    });
    
    if (!subscription) {
      return res.status(404).json({ error: "Subscription not found" });
    }
    
    res.json(subscription); // Return object directly
  } catch (err) {
    console.error("Fetch subscription error:", err.message);
    res.status(500).json({ error: "Failed to fetch subscription" });
  }
});

export default router;