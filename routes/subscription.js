import express from "express";
import Subscription from "../models/Subscription.js";
import Plan from "../models/Plans.js"; 
import { requireAuth } from "../middleware/auth.js";
import { initiateStkPush } from "../lib/mpesa.js";

const router = express.Router();

/**
 * Get all available plans (public)
 */
router.get("/plans", async (req, res) => {
  try {
    console.log("📢 Fetching all plans from DB...");
    const plans = await Plan.find().lean();
    
    if (!plans || plans.length === 0) {
      return res.status(404).json({ error: "No plans found" });
    }
    
    res.json({ success: true, data: plans });
  } catch (err) {
    console.error("❌ Error fetching plans:", err.message);
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

/**
 * Get plans by category
 */
router.get("/plans/:category", async (req, res) => {
  try {
    const { category } = req.params;
    console.log(`📢 Fetching ${category} plans from DB...`);
    
    const plans = await Plan.find({ category }).lean();
    
    if (!plans || plans.length === 0) {
      return res.status(404).json({ error: `No ${category} plans found` });
    }
    
    res.json({ success: true, data: plans });
  } catch (err) {
    console.error("❌ Error fetching plans by category:", err.message);
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
      return res.status(400).json({ 
        error: "Missing required fields: category, plan, or phone" 
      });
    }

    console.log("[Subscription] Request received:", req.body);

    // Fetch plan from DB
    const chosenPlan = await Plan.findOne({ category, plan: planName }).lean();
    if (!chosenPlan) {
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
    console.log("[Subscription] Pending subscription saved:", subscription._id);

    // Trigger STK Push
    const mpesaResp = await initiateStkPush({
      phone: phone.startsWith("+") ? phone : `+${phone}`,
      amount: chosenPlan.amount,
      accountRef: subscription._id.toString(),
    });

    res.status(201).json({
      success: true,
      message: "STK Push initiated. Enter M-Pesa PIN to complete.",
      data: {
        subscription,
        mpesa: mpesaResp,
      }
    });
  } catch (err) {
    console.error("[Subscription] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * M-Pesa callback (Safaricom will POST here)
 */
router.post("/mpesa/callback", async (req, res) => {
  try {
    console.log("[M-Pesa Callback] Data received:", JSON.stringify(req.body, null, 2));

    if (!req.body.Body || !req.body.Body.stkCallback) {
      console.error("[M-Pesa Callback] Invalid callback format");
      return res.status(400).json({ ResultCode: 1, ResultDesc: "Invalid callback format" });
    }

    const { Body } = req.body;
    const { ResultCode, CallbackMetadata, ResultDesc } = Body.stkCallback;

    if (ResultCode === 0) {
      // Find the metadata items
      const metadata = CallbackMetadata.Item || [];
      const receiptItem = metadata.find(i => i.Name === "MpesaReceiptNumber");
      const amountItem = metadata.find(i => i.Name === "Amount");
      const accountRefItem = metadata.find(i => i.Name === "AccountReference");
      const phoneItem = metadata.find(i => i.Name === "PhoneNumber");

      if (!receiptItem || !amountItem || !accountRefItem) {
        console.error("[M-Pesa Callback] Missing required metadata");
        return res.status(400).json({ ResultCode: 1, ResultDesc: "Missing metadata" });
      }

      const receipt = receiptItem.Value;
      const amount = amountItem.Value;
      const accountRef = accountRefItem.Value;
      const phone = phoneItem ? phoneItem.Value : null;

      // Update subscription to active
      const subscription = await Subscription.findByIdAndUpdate(
        accountRef,
        {
          status: "active",
          receiptNumber: receipt,
          paidAmount: amount,
          phoneNumber: phone,
          startDate: new Date(),
        },
        { new: true }
      );

      if (!subscription) {
        console.error("[M-Pesa Callback] Subscription not found:", accountRef);
        return res.status(404).json({ ResultCode: 1, ResultDesc: "Subscription not found" });
      }

      console.log("[M-Pesa Callback] Subscription activated:", subscription._id);
    } else {
      // Payment failed - update subscription status
      const accountRef = req.body.Body.stkCallback.CheckoutRequestID;
      if (accountRef) {
        await Subscription.findByIdAndUpdate(
          accountRef,
          { status: "failed", failedReason: ResultDesc },
          { new: true }
        );
      }
      
      console.log("[M-Pesa Callback] Payment failed:", ResultDesc);
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("[M-Pesa Callback] Error:", err.message);
    res.status(500).json({ ResultCode: 1, ResultDesc: "Internal server error" });
  }
});

/**
 * Get user's subscriptions
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    console.log("[Subscription] Fetching subscriptions for:", req.user.sub);
    const subs = await Subscription.find({ userId: req.user.sub }).sort({ createdAt: -1 });
    
    res.json({ 
      success: true, 
      data: subs 
    });
  } catch (err) {
    console.error("[Subscription] Fetch error:", err.message);
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
    
    res.json({ success: true, data: subscription });
  } catch (err) {
    console.error("[Subscription] Fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch subscription" });
  }
});

export default router;