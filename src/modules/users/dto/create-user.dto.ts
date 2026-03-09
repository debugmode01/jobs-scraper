import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsEmail,
    IsEnum,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    IsUrl,
    ValidateNested,
} from 'class-validator';
import { ExperienceLevel, JobSource, UserRole, WorkMode } from '../../../constants/user.constants';

export class UserProfileDto {
    @ApiPropertyOptional({ example: 'Full Stack Developer', description: 'Current job title' })
    @IsOptional()
    @IsString()
    currentTitle?: string;

    @ApiPropertyOptional({ example: 4, description: 'Years of overall experience' })
    @IsOptional()
    @IsNumber()
    yearsOfExperience?: number;

    @ApiPropertyOptional({ example: ['React', 'Node.js'], description: 'Skills' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    skills?: string[];

    @ApiPropertyOptional({ example: ['react developer', 'nodejs developer'], description: 'Keywords for search' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    keywords?: string[];

    @ApiPropertyOptional({ example: '9876543210', description: 'Phone number' })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiPropertyOptional({ example: 'Bhubaneswar, India', description: 'Address or generic location' })
    @IsOptional()
    @IsString()
    location?: string;

    @ApiPropertyOptional({ example: 'https://storage/resume.pdf', description: 'Resume PDF URL' })
    @IsOptional()
    @IsUrl()
    resumeUrl?: string;

    @ApiPropertyOptional({ example: 'https://linkedin.com/in/manas', description: 'LinkedIn URL' })
    @IsOptional()
    @IsUrl()
    linkedinUrl?: string;

    @ApiPropertyOptional({ example: 'https://github.com/manas', description: 'GitHub URL' })
    @IsOptional()
    @IsUrl()
    githubUrl?: string;

    @ApiPropertyOptional({ example: 'https://manas.dev', description: 'Portfolio website URL' })
    @IsOptional()
    @IsUrl()
    portfolioUrl?: string;
}

export class UserJobPreferencesDto {
    @ApiPropertyOptional({ example: ['Full Stack Developer'], description: 'Preferred roles' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    preferredRoles?: string[];

    @ApiPropertyOptional({ example: ['Bangalore', 'Remote'], description: 'Preferred locations' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    preferredLocations?: string[];

    @ApiPropertyOptional({ enum: WorkMode, isArray: true, example: [WorkMode.REMOTE, WorkMode.HYBRID] })
    @IsOptional()
    @IsArray()
    @IsEnum(WorkMode, { each: true })
    workMode?: WorkMode[];

    @ApiPropertyOptional({ enum: ExperienceLevel, example: ExperienceLevel.MID })
    @IsOptional()
    @IsEnum(ExperienceLevel)
    experienceLevel?: ExperienceLevel;

    @ApiPropertyOptional({ example: 800000, description: 'Minimum expected salary' })
    @IsOptional()
    @IsNumber()
    minSalary?: number;

    @ApiPropertyOptional({ example: 2000000, description: 'Maximum expected salary' })
    @IsOptional()
    @IsNumber()
    maxSalary?: number;
}

export class UserAutoApplySettingsDto {
    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @ApiPropertyOptional({ example: 20 })
    @IsOptional()
    @IsNumber()
    maxApplicationsPerDay?: number;

    @ApiPropertyOptional({ example: ['TCS', 'Infosys'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    excludeCompanies?: string[];

    @ApiPropertyOptional({ example: ['PHP', 'WordPress'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    excludeKeywords?: string[];
}

export class UserSearchSettingsDto {
    @ApiPropertyOptional({ enum: JobSource, isArray: true, example: [JobSource.LINKEDIN] })
    @IsOptional()
    @IsArray()
    @IsEnum(JobSource, { each: true })
    sources?: JobSource[];

    @ApiPropertyOptional({ example: 60, description: 'Interval in minutes' })
    @IsOptional()
    @IsNumber()
    searchIntervalMinutes?: number;
}

export class UserSystemSettingsDto {
    @ApiPropertyOptional({ example: false })
    @IsOptional()
    @IsBoolean()
    emailVerified?: boolean;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class CreateUserDto {
    @ApiProperty({ example: 'Manas Kumar Swain', description: 'Full name of the user' })
    @IsNotEmpty()
    @IsString()
    name: string;

    @ApiProperty({ example: 'manas@email.com', description: 'Email address of the user' })
    @IsNotEmpty()
    @IsEmail()
    email: string;

    @ApiPropertyOptional({ example: 'strong_password', description: 'Password of the user. Will be hashed' })
    @IsOptional()
    @IsString()
    password?: string;

    @ApiPropertyOptional({ enum: UserRole, example: UserRole.USER, description: 'Role of the user' })
    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;

    @ApiPropertyOptional({ type: UserProfileDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => UserProfileDto)
    profile?: UserProfileDto;

    @ApiPropertyOptional({ type: UserJobPreferencesDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => UserJobPreferencesDto)
    jobPreferences?: UserJobPreferencesDto;

    @ApiPropertyOptional({ type: UserAutoApplySettingsDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => UserAutoApplySettingsDto)
    autoApplySettings?: UserAutoApplySettingsDto;

    @ApiPropertyOptional({ type: UserSearchSettingsDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => UserSearchSettingsDto)
    searchSettings?: UserSearchSettingsDto;

    @ApiPropertyOptional({ type: UserSystemSettingsDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => UserSystemSettingsDto)
    system?: UserSystemSettingsDto;
}
