// src/core/env.ts
import { config as dotenvConfig } from 'dotenv';
import { expand } from 'dotenv-expand';
import { existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

// Load environment files based on NODE_ENV
function loadEnv() {
  const env = process.env.NODE_ENV || 'development';
  const basePath = process.cwd();

  const envFiles = [
    `.env.${env}.local`,
    `.env.${env}`,
    '.env.local',
    '.env'
  ];

  for (const file of envFiles) {
    const fullPath = join(basePath, file);
    if (existsSync(fullPath)) {
      console.log(`📁 Loading environment from: ${file}`);
      const result = dotenvConfig({ path: fullPath });
      expand(result);
    }
  }
}

// Call this before anything else
loadEnv();

// Environment variable schema
const envSchema = z.object({
  // API Keys (required)
  ANTHROPIC_API_KEY : z.string().min(1, "ANTHROPIC_API_KEY  is required"),
  ANTHROPIC_API_URL : z.string().min(1, "ANTHROPIC_API_URL  is required"),
  MONGODB_URI : z.string().min(1, "MONGODB_URI  is required"),
  PERPLEXITY_API_KEY: z.string().min(1, "PERPLEXITY_API_KEY is required"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().min(1, "OPENAI_MODEL is required"),
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  EXA_API_KEY: z.string().min(1, "EXA_API_KEY is required"),
  CORESIGNAL_API: z.string().min(1, "EXA_API_KEY is required"),
  EXPLORIUM_API_KEY: z.string().min(1, "EXPLORIUM_API_KEY is required"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_KEY: z.string().min(1, "SUPABASE_KEY is required"),
  
  // Ollama (with defaults)
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama2'),
  
  // Redis (with defaults)
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  
  // Server (with defaults)
  PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)).default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Optional features
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_MAX: z.string().transform(Number).pipe(z.number().min(1)).default('100'),
  RATE_LIMIT_WINDOW: z.string().default('900000'), // 15 minutes
});

export type EnvConfig = z.infer<typeof envSchema>;

class ConfigManager {
  private _config: EnvConfig;

  constructor() {
    this._config = this.validateConfig();
  }

  private validateConfig(): EnvConfig {
    try {
      // Log all environment variables (redacted for security)
      console.log('🔧 Environment variables found:');
      Object.keys(process.env).forEach(key => {
        if (key.includes('API') || key.includes('KEY') || key.includes('SECRET')) {
          const value = process.env[key];
          if (value && value.length > 4) {
            console.log(`   ${key}: ***${value.slice(-4)}`);
          } else {
            console.log(`   ${key}: [invalid or empty]`);
          }
        } else if (key.includes('URL')) {
          console.log(`   ${key}: ${process.env[key]}`);
        }
      });

      // Load environment variables
      const envVars = {
        ANTHROPIC_API_KEY : process.env.ANTHROPIC_API_KEY ,
        ANTHROPIC_API_URL : process.env.ANTHROPIC_API_URL ,
        MONGODB_URI : process.env.MONGODB_URI ,
        PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        OPENAI_MODEL: process.env.OPENAI_MODEL,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        EXA_API_KEY: process.env.EXA_API_KEY,
        CORESIGNAL_API: process.env.CORESIGNAL_API,
        EXPLORIUM_API_KEY: process.env.EXPLORIUM_API_KEY,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_KEY: process.env.SUPABASE_KEY,
        OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
        OLLAMA_MODEL: process.env.OLLAMA_MODEL,
        REDIS_URL: process.env.REDIS_URL,
        PORT: process.env.PORT,
        NODE_ENV: process.env.NODE_ENV,
        LOG_LEVEL: process.env.LOG_LEVEL,
        CORS_ORIGIN: process.env.CORS_ORIGIN,
        RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX,
        RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW,
      };

      // Validate against schema
      const result = envSchema.safeParse(envVars);

      if (!result.success) {
        const errorMessages = result.error.errors
          .map(err => `- ${err.path.join('.')}: ${err.message}`)
          .join('\n');
        
        throw new Error(`Environment validation failed:\n${errorMessages}`);
      }

      console.log('✅ Environment configuration validated successfully');
      return result.data;
    } catch (error: any) {
      console.error('❌ Failed to load configuration:', error.message);
      process.exit(1);
    }
  }

  get config(): EnvConfig {
    return this._config;
  }

  get isDevelopment(): boolean {
    return this._config.NODE_ENV === 'development';
  }

  get isProduction(): boolean {
    return this._config.NODE_ENV === 'production';
  }

  get corsOrigin(): string | string[] {
    const origin = this._config.CORS_ORIGIN;
    if (origin === '*') return '*';
    return origin.split(',').map(o => o.trim());
  }
}

// Create and export singleton instance
const configManager = new ConfigManager();
export const config = configManager.config;
export const isDevelopment = configManager.isDevelopment;
export const isProduction = configManager.isProduction;