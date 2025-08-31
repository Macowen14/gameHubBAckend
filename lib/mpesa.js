import axios from "axios";

// Configure axios with better defaults
const mpesaAxios = axios.create({
  timeout: 30000,
  validateStatus: function (status) {
    return status >= 200 && status < 500;
  }
});

// Get OAuth token from Safaricom with retry logic
export async function getMpesaToken(retries = 3) {
  try {
    console.log("[M-Pesa] Fetching access token...");
    
    if (!process.env.MPESA_CONSUMER_KEY || !process.env.MPESA_CONSUMER_SECRET) {
      throw new Error("M-Pesa credentials not configured");
    }
    
    const auth = Buffer.from(
      `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString("base64");
    
    const response = await mpesaAxios.get(
      `${process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke'}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Cache-Control': 'no-cache'
        },
      }
    );
    
    if (response.data.error) {
      throw new Error(response.data.error);
    }
    
    if (!response.data.access_token) {
      throw new Error("No access token received");
    }
    
    console.log("[M-Pesa] Access token retrieved successfully");
    return response.data.access_token;
  } catch (err) {
    console.error(`[M-Pesa] Token fetch failed (${retries} retries left):`, err.response?.data || err.message);
    
    if (retries > 0 && err.code !== 'ECONNABORTED') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return getMpesaToken(retries - 1);
    }
    
    throw new Error(`Failed to get M-Pesa access token: ${err.message}`);
  }
}

// Validate and format phone number
function formatPhoneNumber(phone) {
  if (!phone) throw new Error("Phone number is required");
  
  // Remove all non-digit characters
  const cleaned = phone.replace(/[^0-9]/g, "");
  
  // Handle various formats
  if (cleaned.startsWith("0")) {
    return "254" + cleaned.substring(1);
  } else if (cleaned.startsWith("7") && cleaned.length === 9) {
    return "254" + cleaned;
  } else if (cleaned.startsWith("254") && cleaned.length === 12) {
    return cleaned;
  } else if (cleaned.startsWith("+254")) {
    return cleaned.substring(1);
  }
  
  throw new Error(`Invalid phone number format: ${phone}`);
}

// Initiate STK Push with enhanced error handling
export async function initiateStkPush({ phone, amount, accountRef, transactionDesc = "Subscription Payment" }) {
  try {
    console.log("[M-Pesa] Initiating STK Push for:", { phone, amount, accountRef });

    const token = await getMpesaToken();

    if (!process.env.MPESA_SHORTCODE || !process.env.MPESA_PASSKEY) {
      throw new Error("M-Pesa shortcode or passkey not configured");
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      process.env.MPESA_SHORTCODE +
      process.env.MPESA_PASSKEY +
      timestamp
    ).toString("base64");

    const formattedPhone = formatPhoneNumber(phone);

    const requestData = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: process.env.MPESA_CALLBACK_URL || `${process.env.BASE_URL}/api/subscriptions/mpesa/callback`,
      AccountReference: accountRef.toString().substring(0, 12),
      TransactionDesc: transactionDesc.substring(0, 13),
    };

    console.log("[M-Pesa] STK Push request payload:", requestData);

    const response = await mpesaAxios.post(
      `${process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke'}/mpesa/stkpush/v1/processrequest`,
      requestData,
      {
        headers: { 
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (response.data.ResponseCode !== "0") {
      throw new Error(`M-Pesa API error: ${response.data.ResponseDescription}`);
    }

    console.log("[M-Pesa] STK Push initiated successfully:", response.data);
    return {
      success: true,
      data: response.data,
      checkoutRequestId: response.data.CheckoutRequestID,
      merchantRequestId: response.data.MerchantRequestID
    };
  } catch (err) {
    console.error("[M-Pesa] STK Push failed:", {
      error: err.message,
      phone,
      amount,
      accountRef,
      timestamp: new Date().toISOString()
    });
    
    // Enhanced error classification
    let errorMessage = err.message;
    let userFriendlyMessage = "Payment initiation failed";
    
    if (err.response?.data) {
      const mpesaError = err.response.data;
      errorMessage = mpesaError.errorMessage || mpesaError.ResponseDescription || JSON.stringify(mpesaError);
      
      // User-friendly messages based on common error codes 
      if (mpesaError.ResponseCode === "1032") {
        userFriendlyMessage = "Payment was cancelled by user";
      } else if (mpesaError.ResponseCode === "1037") {
        userFriendlyMessage = "Unable to reach your phone. Please ensure it's connected and try again";
      } else if (mpesaError.ResponseCode === "1") {
        userFriendlyMessage = "Insufficient balance in your M-Pesa account";
      }
    }
    
    throw new Error(userFriendlyMessage);
  }
}

// Query transaction status 
export async function queryTransactionStatus(checkoutRequestId) {
  try {
    const token = await getMpesaToken();
    
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      process.env.MPESA_SHORTCODE +
      process.env.MPESA_PASSKEY +
      timestamp
    ).toString("base64");

    const requestData = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    };

    const response = await mpesaAxios.post(
      `${process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke'}/mpesa/stkpushquery/v1/query`,
      requestData,
      {
        headers: { 
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data;
  } catch (err) {
    console.error("[M-Pesa] Query transaction failed:", err.message);
    throw err;
  }
}