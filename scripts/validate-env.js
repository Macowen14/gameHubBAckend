// scripts/validate-mpesa-env.js
import Logger from '../lib/logger';
const logger = new Logger('env-validation');

function validateMpesaEnvironment() {
  const requiredEnvVars = [
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_BASE_URL',
    'MPESA_CALLBACK_URL'
  ];

  logger.info('Validating M-Pesa environment variables');

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    logger.error('Missing required environment variables', {
      missingVariables: missingVars
    });
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // Validate MPESA_BASE_URL
  if (!process.env.MPESA_BASE_URL.includes('https://')) {
    logger.warn('MPESA_BASE_URL may be incorrectly configured', {
      currentValue: process.env.MPESA_BASE_URL
    });
  }

  logger.info('M-Pesa environment validation passed');
}

// Run validation if this script is executed directly
if (require.main === module) {
  validateMpesaEnvironment();
}

export default { validateMpesaEnvironment };