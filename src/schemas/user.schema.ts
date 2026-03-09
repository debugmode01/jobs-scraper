import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserRole, WorkMode, ExperienceLevel, JobSource } from '../constants/user.constants';

export type UserDocument = User & Document;

@Schema({ _id: false })
export class UserProfile {
    @Prop()
    currentTitle: string;

    @Prop()
    yearsOfExperience: number;

    @Prop({ type: [String] })
    skills: string[];

    @Prop({ type: [String] })
    keywords: string[];

    @Prop()
    phone: string;

    @Prop()
    location: string;

    @Prop()
    resumeUrl: string;

    @Prop()
    linkedinUrl: string;

    @Prop()
    githubUrl: string;

    @Prop()
    portfolioUrl: string;
}

@Schema({ _id: false })
export class UserJobPreferences {
    @Prop({ type: [String] })
    preferredRoles: string[];

    @Prop({ type: [String] })
    preferredLocations: string[];

    @Prop({ type: [String], enum: Object.values(WorkMode) })
    workMode: WorkMode[];

    @Prop({ type: String, enum: ExperienceLevel })
    experienceLevel: ExperienceLevel;

    @Prop()
    minSalary: number;

    @Prop()
    maxSalary: number;
}

@Schema({ _id: false })
export class UserAutoApplySettings {
    @Prop({ default: true })
    enabled: boolean;

    @Prop({ default: 20 })
    maxApplicationsPerDay: number;

    @Prop({ type: [String] })
    excludeCompanies: string[];

    @Prop({ type: [String] })
    excludeKeywords: string[];
}

@Schema({ _id: false })
export class UserSearchSettings {
    @Prop({ type: [String], enum: Object.values(JobSource) })
    sources: JobSource[];

    @Prop({ default: 60 })
    searchIntervalMinutes: number;
}

@Schema({ _id: false })
export class UserSystemConfig {
    @Prop({ default: false })
    emailVerified: boolean;

    @Prop({ default: true })
    isActive: boolean;

    @Prop({ default: Date.now })
    createdAt: Date;

    @Prop({ default: Date.now })
    updatedAt: Date;
}

@Schema({ timestamps: true, collection: 'users' })
export class User {
    @Prop()
    name: string;

    @Prop({ unique: true, required: true })
    email: string;

    @Prop()
    password?: string;

    @Prop({ type: String, enum: UserRole, default: UserRole.USER })
    role: UserRole;

    @Prop({ type: UserProfile })
    profile: UserProfile;

    @Prop({ type: UserJobPreferences })
    jobPreferences: UserJobPreferences;

    @Prop({ type: UserAutoApplySettings })
    autoApplySettings: UserAutoApplySettings;

    @Prop({ type: UserSearchSettings })
    searchSettings: UserSearchSettings;

    @Prop({ type: UserSystemConfig })
    system: UserSystemConfig;
}

export const UserSchema = SchemaFactory.createForClass(User);