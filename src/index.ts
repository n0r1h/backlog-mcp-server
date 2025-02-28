#!/usr/bin/env node

/**
 * This is a template MCP server that implements a simple notes system.
 * It demonstrates core MCP concepts like resources and tools by allowing:
 * - Listing notes as resources
 * - Reading individual notes
 * - Creating new notes via a tool
 * - Summarizing all notes via a prompt
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { config } from 'dotenv';
import { BacklogClient } from './services/backlog-client.js';
import { CreateIssueParams } from './types/backlog.js';

/**
 * Type alias for a note object.
 */
type Note = { title: string, content: string };

/**
 * Simple in-memory storage for notes.
 * In a real implementation, this would likely be backed by a database.
 */
const notes: { [id: string]: Note } = {
  "1": { title: "First Note", content: "This is note 1" },
  "2": { title: "Second Note", content: "This is note 2" }
};

// Load environment variables
config();

// Initialize Backlog client
const backlogClient = new BacklogClient({
  apiKey: process.env.BACKLOG_API_KEY!,
  spaceId: process.env.BACKLOG_SPACE_ID!
});

/**
 * Create an MCP server with capabilities for resources (to list/read notes),
 * tools (to create new notes), and prompts (to summarize notes).
 */
const server = new Server(
  {
    name: "backlog-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      prompts: {},
      tools: {}  // ツール機能を有効化
    },
  }
);

// エラーハンドリングのセットアップ
server.onerror = (error) => {
  console.error("[MCP Error]", error);
};

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

/**
 * Handler for listing available notes as resources.
 * Each note is exposed as a resource with:
 * - A note:// URI scheme
 * - Plain text MIME type
 * - Human readable name and description (now including the note title)
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    const projects = await backlogClient.getProjects();

    const resources = [
      // プロジェクト一覧のリソース
      {
        uri: `backlog:///projects`,
        mimeType: "application/json",
        name: "Backlog Projects",
        description: "List of all Backlog projects"
      },
      // 個別のプロジェクトリソース
      ...projects.map(project => ({
        uri: `backlog:///project/${project.id}`,
        mimeType: "application/json",
        name: project.name,
        description: project.description || `Backlog project: ${project.name}`
      }))
    ];

    return { resources };
  } catch (error) {
    console.error('Error fetching Backlog resources:', error);
    throw new McpError(ErrorCode.InternalError, 'Failed to fetch Backlog resources');
  }
});

/**
 * Handler for reading the contents of a specific note.
 * Takes a note:// URI and returns the note content as plain text.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const paths = url.pathname.slice(1).split('/');
  
  try {
    let content: any;
    
    switch (paths[0]) {
      case 'projects': {
        // プロジェクト一覧
        const projects = await backlogClient.getProjects();
        content = {
          total: projects.length,
          projects: projects.map(p => ({
            id: p.id,
            key: p.projectKey,
            name: p.name,
            description: p.description,
            _links: {
              self: `backlog:///project/${p.id}`,
              issues: `backlog:///project/${p.id}/issues`
            }
          }))
        };
        break;
      }

      case 'project': {
        const projectId = paths[1];
        if (!projectId) {
          throw new McpError(ErrorCode.InvalidRequest, 'Project ID is required');
        }

        if (paths.length === 2) {
          // 個別のプロジェクト情報
          const project = await backlogClient.getProject(projectId);
          content = {
            ...project,
            _links: {
              self: `backlog:///project/${project.id}`,
              issues: `backlog:///project/${project.id}/issues`
            }
          };
        } else if (paths[2] === 'issues') {
          // プロジェクトの課題一覧を取得
          console.log(`Fetching issues for project ${projectId}`); // デバッグログを追加
          const issues = await backlogClient.getIssues(parseInt(projectId));
          content = {
            total: issues.length,
            issues: issues.map(issue => ({
              id: issue.id,
              issueKey: issue.issueKey,
              summary: issue.summary,
              status: issue.status,
              _links: {
                self: `backlog:///issue/${issue.id}`,
                comments: `backlog:///issue/${issue.id}/comments`,
                project: `backlog:///project/${issue.projectId}`
              }
            }))
          };
        }
        break;
      }

      case 'issue': {
        if (paths.length === 2) {
          // 個別の課題情報
          const issue = await backlogClient.getIssue(paths[1]);
          content = {
            ...issue,
            _links: {
              self: `backlog:///issue/${issue.id}`,
              comments: `backlog:///issue/${issue.id}/comments`,
              project: `backlog:///project/${issue.projectId}`
            }
          };
        } else if (paths[2] === 'comments') {
          // 課題のコメント一覧
          const comments = await backlogClient.getComments(parseInt(paths[1]));
          content = {
            total: comments.length,
            comments: comments.map(comment => ({
              ...comment,
              _links: {
                self: `backlog:///issue/${paths[1]}/comment/${comment.id}`,
                issue: `backlog:///issue/${paths[1]}`
              }
            }))
          };
        }
        break;
      }
    }

    if (!content) {
      throw new McpError(ErrorCode.MethodNotFound, `Resource ${request.params.uri} not found`);
    }

    return {
      contents: [{
        uri: request.params.uri,
        mimeType: "application/json",
        text: JSON.stringify(content, null, 2)
      }]
    };
  } catch (error) {
    console.error(`Error reading resource ${request.params.uri}:`, error);
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(ErrorCode.InternalError, `Failed to read resource ${request.params.uri}`);
  }
});

// プロンプト一覧を提供するハンドラー
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "search_mcp_issues",
        description: "MCPに関連する課題を検索して整理する"
      }
    ]
  };
});

// プロンプトの内容を提供するハンドラー
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "search_mcp_issues") {
    throw new McpError(ErrorCode.MethodNotFound, "Unknown prompt");
  }

  const projects = await backlogClient.getProjects();
  const allIssues = await Promise.all(
    projects.map(async project => {
      const issues = await backlogClient.getIssues(project.id);
      return issues.filter(issue => 
        issue.summary.toLowerCase().includes('mcp') || 
        issue.description.toLowerCase().includes('mcp')
      );
    })
  );

  const mcpIssues = allIssues.flat();
  
  const issueResources = mcpIssues.map(issue => ({
    type: "resource" as const,
    resource: {
      uri: `backlog:///issue/${issue.id}`,
      mimeType: "application/json",
      text: JSON.stringify({
        summary: issue.summary,
        description: issue.description,
        status: issue.status,
        issueKey: issue.issueKey
      }, null, 2)
    }
  }));

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "以下のMCPに関連する課題を分析し、現状と課題を整理してください："
        }
      },
      ...issueResources.map(resource => ({
        role: "user" as const,
        content: resource
      })),
      {
        role: "user",
        content: {
          type: "text",
          text: "上記の課題について、以下の点を整理してください：\n1. 主な課題の分類\n2. 現在の進捗状況\n3. 残っている課題\n4. 次のアクションとして推奨される事項"
        }
      }
    ]
  };
});

// ツール一覧を提供するハンドラー
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_issue",
        description: "Backlogに新しい課題を登録",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "number",
              description: "プロジェクトID"
            },
            summary: {
              type: "string",
              description: "課題のタイトル"
            },
            description: {
              type: "string",
              description: "課題の説明"
            },
            issueTypeId: {
              type: "number",
              description: "課題種別のID"
            },
            priorityId: {
              type: "number",
              description: "優先度のID (1: 低, 2: 中, 3: 高)"
            },
            startDate: {
              type: "string",
              description: "開始日 (YYYY-MM-DD形式)"
            },
            dueDate: {
              type: "string",
              description: "期限日 (YYYY-MM-DD形式)"
            },
            estimatedHours: {
              type: "number",
              description: "予定時間"
            },
            actualHours: {
              type: "number",
              description: "実績時間"
            },
            assigneeId: {
              type: "number",
              description: "担当者のID"
            }
          },
          required: ["projectId", "summary", "issueTypeId", "priorityId"]
        }
      },
      {
        name: "get_project_details",
        description: "プロジェクトの詳細情報を取得",
        inputSchema: {
          type: "object",
          properties: {
            projectIdOrKey: {
              type: "string",
              description: "プロジェクトIDまたはプロジェクトキー"
            }
          },
          required: ["projectIdOrKey"]
        }
      },
      {
        name: "get_project_issues",
        description: "プロジェクトの課題一覧を取得",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "number",
              description: "プロジェクトID"
            },
            keyword: {
              type: "string",
              description: "検索キーワード（オプション）"
            }
          },
          required: ["projectId"]
        }
      },
      {
        name: "get_issue_with_comments",
        description: "課題の詳細情報とコメントを取得",
        inputSchema: {
          type: "object",
          properties: {
            issueIdOrKey: {
              type: "string",
              description: "課題のIDまたはキー"
            }
          },
          required: ["issueIdOrKey"]
        }
      }
    ]
  };
});

// ツールを実行するハンドラー
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.error("Received CallToolRequest:", request);
  try {
    if (!request.params.arguments) {
      throw new Error("No arguments provided");
    }

    switch (request.params.name) {
      case "create_issue": {
        const args = request.params.arguments as unknown as CreateIssueParams;
        if (!args.projectId || !args.summary || !args.issueTypeId || !args.priorityId) {
          throw new Error("Missing required arguments for issue creation");
        }

        const issue = await backlogClient.createIssue(args);
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              ...issue,
              _links: {
                self: `backlog:///issue/${issue.id}`
              }
            })
          }]
        };
      }

      case "get_project_details": {
        const args = request.params.arguments as unknown as { projectIdOrKey: string };
        if (!args.projectIdOrKey) {
          throw new Error("Missing required argument: projectIdOrKey");
        }

        const project = await backlogClient.getProject(args.projectIdOrKey);
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              ...project,
              _links: {
                self: `backlog:///project/${project.id}`,
                issues: `backlog:///project/${project.id}/issues`
              }
            })
          }]
        };
      }

      case "get_project_issues": {
        const args = request.params.arguments as unknown as { projectId: number, keyword?: string };
        if (!args.projectId) {
          throw new Error("Missing required argument: projectId");
        }

        const issues = await backlogClient.getIssues(args.projectId);
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              total: issues.length,
              issues: issues.map(issue => ({
                ...issue,
                _links: {
                  self: `backlog:///issue/${issue.id}`
                }
              }))
            })
          }]
        };
      }

      case "get_issue_with_comments": {
        const args = request.params.arguments as unknown as { issueIdOrKey: string };
        if (!args.issueIdOrKey) {
          throw new Error("Missing required argument: issueIdOrKey");
        }

        const issue = await backlogClient.getIssue(args.issueIdOrKey);
        const comments = await backlogClient.getComments(issue.id);
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              issue: {
                ...issue,
                _links: {
                  self: `backlog:///issue/${issue.id}`
                }
              },
              comments: comments.map(comment => ({
                ...comment,
                _links: {
                  self: `backlog:///issue/${issue.id}/comment/${comment.id}`
                }
              }))
            })
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    console.error("Error executing tool:", error);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        })
      }]
    };
  }
});

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Backlog MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
