// scripts/validate-env.ts
import { config } from '../src/core/config.js';
import { logger } from '../src/core/logger.js';

async function validateEnvironment() {
  logger.info('🔍 Validating environment configuration...');
  
  const checks = [
    {
      name: 'EXA API Key',
      value: config.EXA_API_KEY,
      valid: config.EXA_API_KEY.length > 0 && !config.EXA_API_KEY.includes('your_')
    },
    {
      name: 'Explorium API Key',
      value: config.EXPLORIUM_API_KEY,
      valid: config.EXPLORIUM_API_KEY.length > 0 && !config.EXPLORIUM_API_KEY.includes('your_')
    },
    {
      name: 'Supabase URL',
      value: config.SUPABASE_URL,
      valid: config.SUPABASE_URL.includes('.supabase.co')
    },
    {
      name: 'Supabase Key',
      value: config.SUPABASE_KEY ? '***' + config.SUPABASE_KEY.slice(-4) : 'missing',
      valid: config.SUPABASE_KEY.length > 0
    },
    {
      name: 'Ollama Connection',
      value: config.OLLAMA_BASE_URL,
      valid: true // We'll test this separately
    }
  ];

  let allValid = true;

  for (const check of checks) {
    if (check.valid) {
      logger.info(`✅ ${check.name}: ${check.value}`);
    } else {
      logger.error(`❌ ${check.name}: ${check.value}`);
      allValid = false;
    }
  }

  // Test Ollama connection
  try {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`);
    if (response.ok) {
      logger.info('✅ Ollama: Connected successfully');
    } else {
      logger.error('❌ Ollama: Connection failed');
      allValid = false;
    }
  } catch (error) {
    logger.error(`❌ Ollama: ${error.message}`);
    allValid = false;
  }

  if (allValid) {
    logger.info('🎉 All environment checks passed!');
    process.exit(0);
  } else {
    logger.error('💥 Some environment checks failed. Please check your configuration.');
    process.exit(1);
  }
}

validateEnvironment().catch(error => {
  logger.error('Validation script error:', error);
  process.exit(1);
});