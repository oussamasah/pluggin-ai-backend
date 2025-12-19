// src/models/GTMIntelligence.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface GTMPersonaIntelligence extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  icpModelId: Types.ObjectId;
  companyId: Types.ObjectId;
  employeeId: Types.ObjectId;
  overview: string;
  createdAt: Date;
  updatedAt: Date;
}

const GTMPersonaIntelligenceSchema= new Schema<GTMPersonaIntelligence>(
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
    employeeId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Employee', 
      required: true, 
      index: true 
    },
    
    // Text-based analysis fields
    overview: { 
      type: String, 
      required: true 
    },
},
  { 
    timestamps: true,
    collection: 'gtm_persona_intelligence'
  }
);

// Indexes for efficient querying
GTMPersonaIntelligenceSchema.index({ sessionId: 1, employeeId: 1, companyId: 1 }, { unique: true });


// Text search index for analysis fields
GTMPersonaIntelligenceSchema.index({
  overview: 'text'
});

// Virtual for easy access to company data
GTMPersonaIntelligenceSchema.virtual('company', {
  ref: 'Company',
  localField: 'companyId',
  foreignField: '_id',
  justOne: true
});

// Virtual for easy access to ICP model
GTMPersonaIntelligenceSchema.virtual('icpModel', {
  ref: 'ICPModel',
  localField: 'icpModelId',
  foreignField: '_id',
  justOne: true
});

export const GTMPersonaIntelligence = mongoose.model<GTMPersonaIntelligence>('GTMPersonaIntelligence', GTMPersonaIntelligenceSchema);