import { FastifyInstance, FastifyRequest } from "fastify";
import { ollamaService } from '../services/OllamaService.js';

interface AnalyzeSignalsBody {
  sessionId: string;
  scope: string;
  analysisType: string;
}

interface AnalyzeComparisonBody {
  sessionId: string;
  companies: any[];
  analysisType: string;
}

interface AnalyzeResultsBody {
  sessionId: string;
  companies: any[];
  analysisType: string;
}

interface MergeQueriesBody {
  previousQuery: string;
  newQuery: string;
}

export async function AnalysisController(fastify: FastifyInstance) {
  // Analyze signals
  fastify.post('/analyze-signals', async (request: FastifyRequest<{ Body: AnalyzeSignalsBody }>, reply) => {
    try {
      const { sessionId, scope, analysisType } = request.body;
      
      // Get session data (you might need to fetch this from your database)
      // const session = await sessionService.getSession(sessionId);
      
      // For now, generate a signals analysis using Ollama
      const analysis = await ollamaService.generate(
        `Analyze market signals and growth trends for scope: ${scope}. Analysis type: ${analysisType}`,
        'You are a market intelligence analyst. Analyze growth signals, hiring trends, funding patterns, and market dynamics.'
      );
      
      reply.send({ 
        analysis,
        scope,
        analysisType,
        sessionId
      });
    } catch (error) {
      console.error('Signals analysis error:', error);
      reply.status(500).send({ error: 'Failed to analyze signals' });
    }
  });

  // Compare companies
  fastify.post('/analyze-comparison', async (request: FastifyRequest<{ Body: AnalyzeComparisonBody }>, reply) => {
    try {
      const { sessionId, companies, analysisType } = request.body;
      
      if (!companies || companies.length === 0) {
        return reply.status(400).send({ error: 'No companies provided for comparison' });
      }

      const companyData = companies.map((company, index) => `
${index + 1}. ${company.name}
   - Industry: ${company.industry || 'N/A'}
   - Employees: ${company.employees || 'N/A'}
   - Location: ${company.location || 'N/A'}
   - ICP Score: ${company.icpScore || 'N/A'}
   - Intent Score: ${company.intentScore || 'N/A'}
   - Technologies: ${company.technologies?.join(', ') || 'N/A'}
      `).join('\n');

      const prompt = `
COMPANIES TO COMPARE:
${companyData}

Please provide a comparative analysis focusing on:
1. Strengths and weaknesses of each company
2. Market positioning differences
3. Growth potential indicators
4. Key differentiators and competitive advantages
5. Strategic recommendations

Format as a clear, scannable analysis with specific insights for each company.
      `;

      const comparison = await ollamaService.generate(
        prompt,
        'You are a strategic business analyst specializing in company comparison and market analysis.'
      );
      
      reply.send({ 
        analysis: comparison,
        companiesCount: companies.length,
        analysisType,
        sessionId
      });
    } catch (error) {
      console.error('Comparison analysis error:', error);
      reply.status(500).send({ error: 'Failed to analyze company comparison' });
    }
  });

  // Detailed analysis
  fastify.post('/analyze-results', async (request: FastifyRequest<{ Body: AnalyzeResultsBody }>, reply) => {
    try {
      const { sessionId, companies, analysisType } = request.body;
      
      if (!companies || companies.length === 0) {
        return reply.status(400).send({ error: 'No companies provided for analysis' });
      }

      // Calculate some basic metrics
      const totalCompanies = companies.length;
      const avgIcpScore = Math.round(companies.reduce((sum, c) => sum + (c.icpScore || 0), 0) / totalCompanies);
      const avgIntentScore = Math.round(companies.reduce((sum, c) => sum + (c.intentScore || 0), 0) / totalCompanies);
      const highQualityCount = companies.filter(c => (c.icpScore || 0) >= 80).length;

      const prompt = `
DETAILED ANALYSIS REQUEST:
- Total Companies: ${totalCompanies}
- Average ICP Score: ${avgIcpScore}
- Average Intent Score: ${avgIntentScore}
- High Quality Matches (80+ ICP): ${highQualityCount}
- Analysis Type: ${analysisType}

COMPANY DATA SAMPLE (${companies.length} companies):
${companies.slice(0, 10).map(company => `
- ${company.name}: ${company.industry || 'N/A'}, ${company.employees || 'N/A'} employees, ${company.location || 'N/A'}
  ICP: ${company.icpScore || 'N/A'}, Intent: ${company.intentScore || 'N/A'}
  ${company.technologies?.length ? `Tech: ${company.technologies.slice(0, 3).join(', ')}` : ''}
`).join('')}

Please provide a comprehensive analysis covering:
1. Overall market landscape and trends
2. Quality assessment of matches
3. Industry concentration patterns
4. Geographic distribution insights
5. Technology stack observations
6. Growth signal patterns
7. Strategic recommendations and next steps

Focus on actionable intelligence and market insights.
      `;

      const analysis = await ollamaService.generate(
        prompt,
        'You are a senior market intelligence analyst. Provide strategic insights and actionable recommendations based on company data.'
      );
      
      reply.send({ 
        analysis,
        metrics: {
          totalCompanies,
          avgIcpScore,
          avgIntentScore,
          highQualityCount,
          highQualityPercentage: Math.round((highQualityCount / totalCompanies) * 100)
        },
        analysisType,
        sessionId
      });
    } catch (error) {
      console.error('Detailed analysis error:', error);
      reply.status(500).send({ error: 'Failed to perform detailed analysis' });
    }
  });

  // Merge queries
  fastify.post('/merge-queries', async (request: FastifyRequest<{ Body: MergeQueriesBody }>, reply) => {
    try {
      const { previousQuery, newQuery } = request.body;
      
      if (!previousQuery || !newQuery) {
        return reply.status(400).send({ error: 'Both previousQuery and newQuery are required' });
      }

      const prompt = `
QUERY MERGING REQUEST:

Previous Search: "${previousQuery}"
New Refinement: "${newQuery}"

Please merge these into a single, coherent search query that:
1. Maintains the original intent
2. Incorporates the new refinement naturally
3. Creates a logical, searchable query
4. Is concise and under 200 characters if possible

Respond with ONLY the merged query, no additional text.
      `;

      const merged = await ollamaService.generate(
        prompt,
        'You are a search query optimization expert. Merge search queries into single, coherent queries. Respond with only the merged query.'
      );
      
      // Clean up the response
      const mergedQuery = merged.trim().replace(/["']/g, '').replace(/^Merged query:\s*/i, '');
      
      reply.send({ 
        mergedQuery,
        originalQueries: {
          previous: previousQuery,
          new: newQuery
        }
      });
    } catch (error) {
      console.error('Query merge error:', error);
      reply.status(500).send({ error: 'Failed to merge queries' });
    }
  });
}