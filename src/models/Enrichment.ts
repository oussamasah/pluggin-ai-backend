
// src/models/Enrichment.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEnrichment extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  sessionId: Types.ObjectId;
  icpModelId?: Types.ObjectId;
  data: Record<string, any>;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const EnrichmentSchema = new Schema<IEnrichment>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    icpModelId: { type: Schema.Types.ObjectId, ref: 'ICPModel', index: true },
    data: { type: Schema.Types.Mixed, required: true },
    source: { type: String, required: true }
  },
  { 
    timestamps: true,
    collection: 'enrichments'
  }
);

// Indexes
EnrichmentSchema.index({ companyId: 1, source: 1 });
EnrichmentSchema.index({ sessionId: 1 });

export const Enrichment = mongoose.model<IEnrichment>('Enrichment', EnrichmentSchema);
