// lib/mpesa.js
import axios from "axios";
import Logger from './logger.js';
const logger = new Logger('mpesa-service');

// Configure axios with better defaults
const mpesaAxios = axios.create({
  timeout: 30000,
  validateStatus: function (status) {
    return status >= 200 && status < 500;
  }
});

// Token caching with expiration check
let tokenCache = {
  token: null,
  expiresAt: null
};

// Generate unique request ID
function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
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

// Get OAuth token from Safaricom with retry logic and caching
async function getMpesaToken(retries = 3) {
  // Return cached token if valid
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 30000) {
    logger.debug('Using cached M-Pesa token', {
      expiresIn: tokenCache.expiresAt - Date.now()
    });
    return tokenCache.token;
  }

  try {
    logger.info('Fetching new M-Pesa access token');
    
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
        timeout: 10000
      }
    );
    
    if (response.data.error) {
      throw new Error(response.data.error);
    }
    
    if (!response.data.access_token) {
      throw new Error("No access token received");
    }

    // Cache token with expiration (typically 1 hour)
    tokenCache = {
      token: response.data.access_token,
      expiresAt: Date.now() + (response.data.expires_in || 3600) * 1000
    };

    logger.info('M-Pesa token retrieved successfully', {
      expiresIn: response.data.expires_in
    });
    
    return response.data.access_token;
  } catch (err) {
    logger.error('M-Pesa token fetch failed', {
      error: err.message,
      response: err.response?.data,
      retriesLeft: retries
    });
    
    if (retries > 0 && err.code !== 'ECONNABORTED') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return getMpesaToken(retries - 1);
    }
    
    throw new Error(`Failed to get M-Pesa access token: ${err.message}`);
  }
}

// Initiate STK Push with enhanced error handling and logging
export async function initiateStkPush({ phone, amount, accountRef, transactionDesc = "Subscription Payment" }) {
  const requestId = generateRequestId();
  const requestLogger = logger.withRequestId(requestId);

  try {
    requestLogger.info('Initiating STK Push', {
      phone: phone ? '***' + phone.slice(-3) : undefined,
      amount,
      accountRef,
      transactionDesc
    });

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

    requestLogger.debug('STK Push request payload', {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: '***' + formattedPhone.slice(-3),
      PartyB: process.env.MPESA_SHORTCODE,
      CallBackURL: process.env.MPESA_CALLBACK_URL
    });

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
      requestLogger.error('M-Pesa API error response', {
        responseCode: response.data.ResponseCode,
        responseDescription: response.data.ResponseDescription,
        requestData: {
          ...requestData,
          PhoneNumber: '***' + requestData.PhoneNumber.slice(-3)
        }
      });
      
      throw new Error(`M-Pesa API error: ${response.data.ResponseDescription}`);
    }

    requestLogger.info('STK Push initiated successfully', {
      checkoutRequestId: response.data.CheckoutRequestID,
      merchantRequestId: response.data.MerchantRequestID
    });
    
    return {
      success: true,
      data: response.data,
      checkoutRequestId: response.data.CheckoutRequestID,
      merchantRequestId: response.data.MerchantRequestID
    };
  } catch (err) {
    requestLogger.error('STK Push failed', {
      error: err.message,
      stack: err.stack,
      phone: phone ? '***' + phone.slice(-3) : undefined,
      amount,
      accountRef,
      timestamp: new Date().toISOString()
    });
    
    // Enhanced error classification
    let userFriendlyMessage = "Payment initiation failed";
    
    if (err.response?.data) {
      const mpesaError = err.response.data;
      
      // User-friendly messages based on common error codes
      const errorMap = {
        "1032": "Payment was cancelled by user",
        "1037": "Unable to reach your phone. Please ensure it's connected and try again",
        "1": "Insufficient balance in your M-Pesa account",
        "1031": "Request cancelled by user",
        "1033": "Transaction timed out",
        "1036": "Transaction request in progress. Please try again later"
      };
      
      userFriendlyMessage = errorMap[mpesaError.ResponseCode] || 
        mpesaError.ResponseDescription || 
        "Payment initiation failed";
    }
    
    throw new Error(userFriendlyMessage);
  }
}

// Query transaction status with enhanced logging
export async function queryTransactionStatus(checkoutRequestId) {
  const requestId = generateRequestId();
  const requestLogger = logger.withRequestId(requestId);
  
  try {
    requestLogger.info('Querying transaction status', {
      checkoutRequestId
    });
    
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

    requestLogger.info('Transaction query completed', {
      checkoutRequestId,
      resultCode: response.data.ResultCode,
      resultDesc: response.data.ResultDesc
    });

    return response.data;
  } catch (err) {
    requestLogger.error('Transaction query failed', {
      error: err.message,
      checkoutRequestId,
      stack: err.stack
    });
    
    throw new Error(`Failed to query transaction status: ${err.message}`);
  }
}

export default {
  getMpesaToken,
  formatPhoneNumber
};