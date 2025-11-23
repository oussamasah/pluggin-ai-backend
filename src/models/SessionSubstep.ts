
// src/models/SessionSubstep.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISessionSubstep extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  stepId: string;
  name: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  category?: string;
  priority: 'low' | 'medium' | 'high';
  tools?: string[];
  message?: string;
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

const SessionSubstepSchema = new Schema<ISessionSubstep>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    stepId: { type: String, required: true },
    name: { type: String, required: true },
    description: String,
    status: { 
      type: String, 
      enum: ['pending', 'in_progress', 'completed', 'failed'],
      default: 'pending' 
    },
    category: String,
    priority: { 
      type: String, 
      enum: ['low', 'medium', 'high'],
      default: 'medium' 
    },
    tools: [String],
    message: String,
    progress: { type: Number, default: 0 },
    startedAt: Date,
    completedAt: Date
  },
  { 
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'session_substeps'
  }
);

// Compound index for unique substeps per session
SessionSubstepSchema.index({ sessionId: 1, stepId: 1 }, { unique: true });
SessionSubstepSchema.index({ sessionId: 1, status: 1 });

export const SessionSubstep = mongoose.model<ISessionSubstep>('SessionSubstep', SessionSubstepSchema);
