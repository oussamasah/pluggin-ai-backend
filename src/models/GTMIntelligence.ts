// src/models/GTMIntelligence.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IGTMIntelligence extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  icpModelId: Types.ObjectId;
  companyId: Types.ObjectId;
  
  // Text-based analysis fields
  overview: string;
  employeeAnalysis: string;
  financialAnalysis: string;
  technologyAnalysis: string;
  intentSignals: string;
  competitorAnalysis: string;
  gtmStrategy: string;
  recommendations: string;
  
  // Scoring and metadata
  icpFitScore: number;
  confidenceScore: number;
  dataCompleteness: number;
  lastRefreshed: Date;
  dataSources: string[];
  refreshStatus: 'pending' | 'in_progress' | 'completed' | 'failed';
  refreshError?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const GTMIntelligenceSchema = new Schema<IGTMIntelligence>(
  {
    sessionId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Session', 
      required: true, 
      index: true 
    },
    icpModelId: { 
      type: Schema.Types.ObjectId, 
      ref: 'ICPModel', 
      required: true, 
      index: true 
    },
    companyId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Company', 
      required: true, 
      index: true 
    },
    
    // Text-based analysis fields
    overview: { 
      type: String, 
      required: true 
    },
    employeeAnalysis: { 
      type: String, 
      required: true 
    },
    financialAnalysis: { 
      type: String, 
      required: true 
    },
    technologyAnalysis: { 
      type: String, 
      required: true 
    },
    intentSignals: { 
      type: String, 
      required: true 
    },
    competitorAnalysis: { 
      type: String, 
      required: true 
    },
    gtmStrategy: { 
      type: String, 
      required: true 
    },
    recommendations: { 
      type: String, 
      required: true 
    },
    
    // Scoring and metadata
    icpFitScore: { 
      type: Number, 
      min: 0, 
      max: 100, 
      default: 0 
    },
    confidenceScore: { 
      type: Number, 
      min: 0, 
      max: 100, 
      default: 0 
    },
    dataCompleteness: { 
      type: Number, 
      min: 0, 
      max: 100, 
      default: 0 
    },
    lastRefreshed: { 
      type: Date, 
      default: Date.now 
    },
    dataSources: { 
      type: [String], 
      default: [] 
    },
    refreshStatus: { 
      type: String, 
      enum: ['pending', 'in_progress', 'completed', 'failed'],
      default: 'pending'
    },
    refreshError: String
  },
  { 
    timestamps: true,
    collection: 'gtm_intelligence'
  }
);

// Indexes for efficient querying
GTMIntelligenceSchema.index({ sessionId: 1, companyId: 1 }, { unique: true });
GTMIntelligenceSchema.index({ icpModelId: 1, icpFitScore: -1 });
GTMIntelligenceSchema.index({ refreshStatus: 1 });
GTMIntelligenceSchema.index({ lastRefreshed: -1 });

// Text search index for analysis fields
GTMIntelligenceSchema.index({
  overview: 'text',
  employeeAnalysis: 'text',
  financialAnalysis: 'text',
  technologyAnalysis: 'text',
  competitorAnalysis: 'text',
  recommendations: 'text'
});

// Virtual for easy access to company data
GTMIntelligenceSchema.virtual('company', {
  ref: 'Company',
  localField: 'companyId',
  foreignField: '_id',
  justOne: true
});

// Virtual for easy access to ICP model
GTMIntelligenceSchema.virtual('icpModel', {
  ref: 'ICPModel',
  localField: 'icpModelId',
  foreignField: '_id',
  justOne: true
});

export const GTMIntelligence = mongoose.model<IGTMIntelligence>('GTMIntelligence', GTMIntelligenceSchema);