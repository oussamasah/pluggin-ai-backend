// scripts/manual-embed.ts
// Script to manually embed companies, employees, and enrichments

// Load environment variables first (before any other imports)
import { config as dotenvConfig } from 'dotenv';
import { expand } from 'dotenv-expand';
import { existsSync } from 'fs';
import { join } from 'path';

// Load .env file
function loadEnv() {
  const basePath = process.cwd();
  const envFiles = [
    '.env.local',
    '.env'
  ];

  for (const file of envFiles) {
    const fullPath = join(basePath, file);
    if (existsSync(fullPath)) {
      console.log(`📁 Loading environment from: ${file}`);
      const result = dotenvConfig({ path: fullPath });
      expand(result);
      break; // Load first found file
    }
  }
}

loadEnv();

// Now import other modules (they will have access to env vars)
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import { Company } from '../src/models/Company.js';
import { Employee } from '../src/models/Employee.js';
import { Enrichment } from '../src/models/Enrichment.js';
import { autoEmbeddingService } from '../src/services/vector/AutoEmbeddingService.js';

interface EmbedOptions {
  type?: 'company' | 'employee' | 'enrichment' | 'all';
  limit?: number;
  forceRegenerate?: boolean;
  companyId?: string;
  userId?: string;
}

async function manualEmbed(options: EmbedOptions = {}) {
  const {
    type = 'all',
    limit = 100,
    forceRegenerate = false,
    companyId,
    userId
  } = options;

  try {
    // Connect to database
    console.log('🔌 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('❌ MONGODB_URI not found in environment variables');
      console.error('💡 Make sure you have a .env file in the project root with MONGODB_URI');
      throw new Error('MONGODB_URI environment variable is required');
    }
    console.log(`📊 MongoDB URI: ${mongoUri.substring(0, 20)}...`);
    await connectDatabase(mongoUri);
    console.log('✅ Connected to MongoDB');
    
    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️  OPENAI_API_KEY not found - will use fallback embeddings');
    } else {
      console.log('✅ OPENAI_API_KEY found - will use OpenAI embeddings');
    }

    let embedded = 0;
    let failed = 0;

    // Embed companies
    if (type === 'company' || type === 'all') {
      console.log('\n📊 Embedding companies...');
      
      const companyQuery: any = {};
      if (companyId) {
        companyQuery._id = companyId;
      }
      if (userId) {
        // Get user's sessions
        const { Session } = await import('../src/models/Session.js');
        const sessions = await Session.find({ userId }).select('_id').lean();
        const sessionIds = sessions.map(s => s._id);
        companyQuery.sessionId = { $in: sessionIds };
      }
      
      if (!forceRegenerate) {
        companyQuery.$or = [
          { embedding: { $exists: false } },
          { embedding: null },
          { embedding: { $size: 0 } },
          { embeddingGeneratedAt: { $exists: false } }
        ];
      }

      const companies = await Company.find(companyQuery).limit(limit);
      console.log(`Found ${companies.length} companies to embed`);

      for (const company of companies) {
        try {
          await autoEmbeddingService.autoEmbedOnSave(company, 'company');
          await company.save();
          embedded++;
          console.log(`✅ [${embedded}/${companies.length}] Embedded: ${company.name}`);
          await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
        } catch (error: any) {
          failed++;
          console.error(`❌ Failed to embed ${company.name}:`, error.message);
        }
      }
    }

    // Embed employees
    if (type === 'employee' || type === 'all') {
      console.log('\n👥 Embedding employees...');
      
      const employeeQuery: any = {};
      if (companyId) {
        employeeQuery.companyId = companyId;
      }
      if (userId) {
        // Get user's companies first
        const { Session } = await import('../src/models/Session.js');
        const sessions = await Session.find({ userId }).select('_id').lean();
        const sessionIds = sessions.map(s => s._id);
        const userCompanies = await Company.find({ sessionId: { $in: sessionIds } }).select('_id').lean();
        const companyIds = userCompanies.map(c => c._id);
        employeeQuery.companyId = { $in: companyIds };
      }
      
      if (!forceRegenerate) {
        employeeQuery.$or = [
          { embedding: { $exists: false } },
          { embedding: null },
          { embedding: { $size: 0 } }
        ];
      }

      const employees = await Employee.find(employeeQuery).limit(limit);
      console.log(`Found ${employees.length} employees to embed`);

      for (const employee of employees) {
        try {
          await autoEmbeddingService.autoEmbedOnSave(employee, 'employee');
          await employee.save();
          embedded++;
          console.log(`✅ [${embedded}/${employees.length}] Embedded: ${employee.fullName}`);
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
          failed++;
          console.error(`❌ Failed to embed ${employee.fullName}:`, error.message);
        }
      }
    }

    // Embed enrichments
    if (type === 'enrichment' || type === 'all') {
      console.log('\n📦 Embedding enrichments...');
      
      const enrichmentQuery: any = {};
      if (companyId) {
        enrichmentQuery.companyId = companyId;
      }
      if (userId) {
        const { Session } = await import('../src/models/Session.js');
        const sessions = await Session.find({ userId }).select('_id').lean();
        const sessionIds = sessions.map(s => s._id);
        enrichmentQuery.sessionId = { $in: sessionIds };
      }
      
      if (!forceRegenerate) {
        enrichmentQuery.$or = [
          { embedding: { $exists: false } },
          { embedding: null },
          { embedding: { $size: 0 } }
        ];
      }

      const enrichments = await Enrichment.find(enrichmentQuery).limit(limit);
      console.log(`Found ${enrichments.length} enrichments to embed`);

      for (const enrichment of enrichments) {
        try {
          await autoEmbeddingService.autoEmbedOnSave(enrichment, 'enrichment');
          await enrichment.save();
          embedded++;
          console.log(`✅ [${embedded}/${enrichments.length}] Embedded enrichment: ${enrichment._id}`);
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
          failed++;
          console.error(`❌ Failed to embed enrichment ${enrichment._id}:`, error.message);
        }
      }
    }

    console.log('\n📊 Summary:');
    console.log(`✅ Successfully embedded: ${embedded}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success rate: ${embedded > 0 ? ((embedded / (embedded + failed)) * 100).toFixed(2) : 0}%`);

  } catch (error: any) {
    console.error('❌ Error in manual embedding:', error);
    process.exit(1);
  } finally {
    await disconnectDatabase();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: EmbedOptions = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '--type':
      options.type = args[++i] as any;
      break;
    case '--limit':
      options.limit = parseInt(args[++i]);
      break;
    case '--force':
      options.forceRegenerate = true;
      break;
    case '--company-id':
      options.companyId = args[++i];
      break;
    case '--user-id':
      options.userId = args[++i];
      break;
    case '--help':
      console.log(`
Manual Embedding Script

Usage:
  npm run embed [options]

Options:
  --type <type>          Type to embed: company, employee, enrichment, or all (default: all)
  --limit <number>       Maximum number of documents to embed (default: 100)
  --force                 Force regenerate embeddings even if they exist
  --company-id <id>      Embed only for a specific company ID
  --user-id <id>         Embed only for a specific user ID
  --help                 Show this help message

Examples:
  npm run embed -- --type company --limit 50
  npm run embed -- --type all --user-id user_123
  npm run embed -- --company-id 507f1f77bcf86cd799439011
  npm run embed -- --type employee --force
      `);
      process.exit(0);
  }
}

// Run the script
manualEmbed(options).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

