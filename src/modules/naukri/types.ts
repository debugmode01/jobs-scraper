export interface AnswerEntry {
    id: string;
    patterns: string[];
    answer: string;
    type: 'text' | 'number' | 'boolean';
}

export interface UnknownQuestion {
    question: string;
    options?: string[];
    fieldType: 'text' | 'textarea' | 'radio' | 'checkbox' | 'select' | 'number' | 'unknown';
    seenAt: string;
    jobTitle?: string;
    jobUrl?: string;
}

export interface AnswerBank {
    _meta: { description: string; matchThreshold: number };
    answers: AnswerEntry[];
    unknown: UnknownQuestion[];
}

export interface Profile {
    personal: Record<string, any>;
    professional: Record<string, any>;
    education: Record<string, any>;
    search: {
        keywords: string[];
        minExperienceYears: number;
        maxExperienceYears: number;
        maxApplicationsPerRun: number;
        freshnessDays?: number;
        sortBy?: 'date' | 'relevance';
    };
}

export interface RunState {
    /** ISO date (YYYY-MM-DD) when daily limit was last hit. */
    dailyLimitHitOn?: string;
    lastRunAt?: string;
    appliedTotal?: number;
}

export interface AppliedJob {
    appliedAt?: string;
    title: string;
    company: string;
    url: string;
    keyword: string;
    status: 'applied' | 'skipped' | 'failed';
    note?: string;
}
