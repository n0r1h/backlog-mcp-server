import axios from 'axios';
import { BacklogConfig, BacklogProject, BacklogIssue, BacklogComment, CreateIssueParams } from '../types/backlog.js';

export class BacklogClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: BacklogConfig) {
    this.baseUrl = `https://${config.spaceId}.backlog.com/api/v2`;
    this.apiKey = config.apiKey;
  }

  private async request<T>(path: string, params: Record<string, any> = {}, method: 'get' | 'post' = 'get', data?: any): Promise<T> {
    try {
      const config = {
        params: method === 'get' ? { apiKey: this.apiKey, ...params } : { apiKey: this.apiKey },
        data: method === 'post' ? data : undefined
      };

      const response = await axios({
        method,
        url: `${this.baseUrl}${path}`,
        ...config
      });
      
      return response.data;
    } catch (error) {
      console.error('Backlog API error:', error);
      throw error;
    }
  }

  async getProjects(): Promise<BacklogProject[]> {
    return this.request<BacklogProject[]>('/projects');
  }

  async getProject(projectIdOrKey: string): Promise<BacklogProject> {
    return this.request<BacklogProject>(`/projects/${projectIdOrKey}`);
  }

  async getIssues(projectId?: number): Promise<BacklogIssue[]> {
    const params = projectId ? { 'projectId[]': projectId } : {};
    return this.request<BacklogIssue[]>('/issues', params);
  }

  async getIssue(issueIdOrKey: string): Promise<BacklogIssue> {
    return this.request<BacklogIssue>(`/issues/${issueIdOrKey}`);
  }

  async getComments(issueId: number): Promise<BacklogComment[]> {
    return this.request<BacklogComment[]>(`/issues/${issueId}/comments`);
  }

  async createIssue(params: CreateIssueParams): Promise<BacklogIssue> {
    return this.request<BacklogIssue>('/issues', {}, 'post', params);
  }
} 