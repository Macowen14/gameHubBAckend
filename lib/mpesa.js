import axios from "axios";

// Get OAuth token from Safaricom
export async function getMpesaToken() {
  try {
    console.log("[M-Pesa] Fetching access token...");
    
    if (!process.env.MPESA_CONSUMER_KEY || !process.env.MPESA_CONSUMER_SECRET) {
      throw new Error("M-Pesa credentials not configured");
    }
    
    const auth = Buffer.from(
      `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString("base64");
    
    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );
    
    console.log("[M-Pesa] Access token retrieved.");
    return response.data.access_token;
  } catch (err) {
    console.error("[M-Pesa] Token fetch failed:", err.response?.data || err.message);
    throw new Error("Failed to get M-Pesa access token");
  }
}

// Initiate STK Push
export async function initiateStkPush({ phone, amount, accountRef }) {
  try {
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

    console.log("[M-Pesa] Sending STK Push request...");

    const requestData = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(amount), // Ensure amount is integer
      PartyA: phone.replace(/[^0-9]/g, ""), // Remove any non-numeric characters
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: phone.replace(/[^0-9]/g, ""),
      CallBackURL: process.env.MPESA_CALLBACK_URL || `${process.env.BASE_URL}/api/subscriptions/mpesa/callback`,
      AccountReference: accountRef.substring(0, 12), // Max 12 characters
      TransactionDesc: "Subscription Payment",
    };

    console.log("[M-Pesa] STK Push request:", requestData);

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      requestData,
      {
        headers: { 
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        timeout: 30000 // 30 second timeout
      }
    );

    console.log("[M-Pesa] STK Push response:", response.data);
    return response.data;
  } catch (err) {
    console.error("[M-Pesa] STK Push failed:", err.response?.data || err.message);
    
    if (err.response) {
      throw new Error(`M-Pesa API error: ${JSON.stringify(err.response.data)}`);
    } else if (err.request) {
      throw new Error("No response received from M-Pesa API");
    } else {
      throw new Error(`STK Push setup error: ${err.message}`);
    }
  }
}