// src/models/Employee.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEmployee extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  coresignalEmployeeId: number; // CoreSignal's numeric ID
  parentId?: number;
  isDeleted: boolean;
  publicProfileId?: number;
  linkedinUrl?: string;
  linkedinShorthandNames?: string[];
  fullName: string;
  firstName: string;
  lastName: string;
  headline?: string;
  summary?: string;
  pictureUrl?: string;
  locationCountry?: string;
  locationCity?: string;
  locationFull?: string;
  connectionsCount?: number;
  followersCount?: number;
  isWorking: boolean;
  activeExperienceTitle?: string;
  activeExperienceCompanyId?: number;
  activeExperienceDepartment?: string;
  isDecisionMaker: boolean;
  totalExperienceDurationMonths?: number;
  primaryProfessionalEmail?: string;
  professionalEmails?: any[];
  interests?: string[];
  inferredSkills?: string[];
  historicalSkills?: string[];
  experienceDepartmentBreakdown?: any[];
  experienceManagementBreakdown?: any[];
  educationDegrees?: string[];
  educationHistory?: any[];
  languages?: any[];
  githubUrl?: string;
  githubUsername?: string;
  experienceHistory?: any[];
  recommendationsCount?: number;
  recommendations?: any[];
  activities?: any[];
  awards?: any[];
  certifications?: any[];
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeSchema = new Schema<IEmployee>(
  {
    companyId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Company', 
      required: true, 
      index: true 
    },
    coresignalEmployeeId: { 
      type: Number, 
      required: true,
      index: true 
    },
    parentId: { 
      type: Number, 
      default: null 
    },
    isDeleted: { 
      type: Boolean, 
      default: false 
    },
    publicProfileId: { 
      type: Number, 
      default: null 
    },
    linkedinUrl: { 
      type: String, 
      default: null 
    },
    linkedinShorthandNames: [{ 
      type: String 
    }],
    fullName: { 
      type: String, 
      required: true,
      trim: true 
    },
    firstName: { 
      type: String, 
      required: true,
      trim: true 
    },
    lastName: { 
      type: String, 
      required: true,
      trim: true 
    },
    headline: { 
      type: String, 
      default: null 
    },
    summary: { 
      type: String, 
      default: null 
    },
    pictureUrl: { 
      type: String, 
      default: null 
    },
    locationCountry: { 
      type: String, 
      default: null 
    },
    locationCity: { 
      type: String, 
      default: null 
    },
    locationFull: { 
      type: String, 
      default: null 
    },
    connectionsCount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    followersCount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    isWorking: { 
      type: Boolean, 
      default: false 
    },
    activeExperienceTitle: { 
      type: String, 
      default: null 
    },
    activeExperienceCompanyId: { 
      type: Number, 
      default: null 
    },
    activeExperienceDepartment: { 
      type: String, 
      default: null 
    },
    isDecisionMaker: { 
      type: Boolean, 
      default: false 
    },
    totalExperienceDurationMonths: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    primaryProfessionalEmail: { 
      type: String, 
      default: null,
      lowercase: true,
      trim: true 
    },
    professionalEmails: [{ 
      type: Schema.Types.Mixed 
    }],
    interests: [{ 
      type: String 
    }],
    inferredSkills: [{ 
      type: String 
    }],
    historicalSkills: [{ 
      type: String 
    }],
    experienceDepartmentBreakdown: [{ 
      type: Schema.Types.Mixed 
    }],
    experienceManagementBreakdown: [{ 
      type: Schema.Types.Mixed 
    }],
    educationDegrees: [{ 
      type: String 
    }],
    educationHistory: [{ 
      type: Schema.Types.Mixed 
    }],
    languages: [{ 
      type: Schema.Types.Mixed 
    }],
    githubUrl: { 
      type: String, 
      default: null 
    },
    githubUsername: { 
      type: String, 
      default: null 
    },
    experienceHistory: [{ 
      type: Schema.Types.Mixed 
    }],
    recommendationsCount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    recommendations: [{ 
      type: Schema.Types.Mixed 
    }],
    activities: [{ 
      type: Schema.Types.Mixed 
    }],
    awards: [{ 
      type: Schema.Types.Mixed 
    }],
    certifications: [{ 
      type: Schema.Types.Mixed 
    }]
  },
  { 
    timestamps: true,
    collection: 'employees'
  }
);

// Compound index to ensure unique employees per company
EmployeeSchema.index({ 
  companyId: 1, 
  coresignalEmployeeId: 1 
}, { 
  unique: true,
  name: 'company_employee_unique' 
});

// Additional indexes for better query performance
EmployeeSchema.index({ isDecisionMaker: 1 });
EmployeeSchema.index({ isWorking: 1 });
EmployeeSchema.index({ fullName: 'text', headline: 'text' });

export const Employee = mongoose.model<IEmployee>('Employee', EmployeeSchema);