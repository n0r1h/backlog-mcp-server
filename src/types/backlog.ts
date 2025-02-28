export interface BacklogProject {
  id: number;
  projectKey: string;
  name: string;
  description: string;
}

export interface BacklogIssue {
  id: number;
  projectId: number;
  issueKey: string;
  summary: string;
  description: string;
  status: {
    id: number;
    name: string;
  };
}

export interface BacklogComment {
  id: number;
  content: string;
  created: string;
  updated: string;
  createdUser: {
    id: number;
    name: string;
    roleType: number;
  };
}

export interface BacklogConfig {
  apiKey: string;
  spaceId: string;
}

export interface CreateIssueParams {
  projectId: number;
  summary: string;
  issueTypeId: number;
  priorityId: number;
  description?: string;
  startDate?: string;
  dueDate?: string;
  estimatedHours?: number;
  actualHours?: number;
  assigneeId?: number;
} 