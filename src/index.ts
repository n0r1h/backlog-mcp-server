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

// Load environment variables
config();

// Initialize Backlog client
const backlogClient = new BacklogClient({
  apiKey: process.env.BACKLOG_API_KEY!,
  spaceId: process.env.BACKLOG_SPACE_ID!
});

/**
 * Create an MCP server with capabilities for tools and prompts.
 */
const server = new Server(
  {
    name: "backlog-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      prompts: {},
      tools: {}
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

// ツール一覧を提供するハンドラー
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_projects",
        description: "Backlogのプロジェクト一覧を取得",
        inputSchema: {
          type: "object",
          properties: {
            keyword: {
              type: "string",
              description: "検索キーワード（オプション）"
            }
          }
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
            },
            statusId: {
              type: "number",
              description: "ステータスID（オプション）"
            }
          },
          required: ["projectId"]
        }
      },
      {
        name: "get_issue_details",
        description: "課題の詳細情報を取得",
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
      },
      {
        name: "get_issue_comments",
        description: "課題のコメント一覧を取得",
        inputSchema: {
          type: "object",
          properties: {
            issueId: {
              type: "number",
              description: "課題のID"
            }
          },
          required: ["issueId"]
        }
      },
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
        name: "create_issue_comment",
        description: "課題にコメントを追加",
        inputSchema: {
          type: "object",
          properties: {
            issueId: {
              type: "number",
              description: "課題のID"
            },
            content: {
              type: "string",
              description: "コメントの内容"
            }
          },
          required: ["issueId", "content"]
        }
      }
    ]
  };
});

// プロンプト一覧を提供するハンドラー
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "analyze_project_issues",
        description: "プロジェクトの課題を分析して整理する"
      },
      {
        name: "summarize_issue_discussion",
        description: "課題の議論を要約する"
      }
    ]
  };
});

// プロンプトの内容を提供するハンドラー
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  switch (request.params.name) {
    case "analyze_project_issues": {
      return {
        messages: [
          {
            role: "system",
            content: {
              type: "text",
              text: "プロジェクトの課題一覧を分析し、以下の点について整理してください：\n1. 主な課題の分類\n2. 現在の進捗状況\n3. 残っている課題\n4. 次のアクションとして推奨される事項\n\nまず、以下のツールを使用してプロジェクト一覧を取得し、分析対象のプロジェクトを選択してください：\n\nlist_projects"
            }
          }
        ]
      };
    }

    case "summarize_issue_discussion": {
      return {
        messages: [
          {
            role: "system",
            content: {
              type: "text",
              text: "課題の議論を要約するために、以下のステップで情報を収集してください：\n\n1. get_issue_details を使用して課題の詳細を取得\n2. get_issue_comments を使用してコメントを取得\n3. 以下の点について整理：\n   - 議論の主なポイント\n   - 決定事項\n   - 未解決の問題\n   - 次のアクション"
            }
          }
        ]
      };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, "Unknown prompt");
  }
});

// ツールを実行するハンドラー
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.error("Received CallToolRequest:", request);
  try {
    if (!request.params.arguments) {
      throw new Error("No arguments provided");
    }

    switch (request.params.name) {
      case "list_projects": {
        const projects = await backlogClient.getProjects();
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              total: projects.length,
              projects: projects.map(project => ({
                ...project,
                _links: {
                  tools: {
                    get_project_details: {
                      name: "get_project_details",
                      arguments: {
                        projectIdOrKey: project.id.toString()
                      }
                    },
                    get_project_issues: {
                      name: "get_project_issues",
                      arguments: {
                        projectId: project.id
                      }
                    },
                    create_issue: {
                      name: "create_issue",
                      template: {
                        projectId: project.id,
                        summary: "",
                        issueTypeId: 0,
                        priorityId: 2
                      }
                    }
                  }
                }
              }))
            }, null, 2)
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
                tools: {
                  get_project_issues: {
                    name: "get_project_issues",
                    arguments: {
                      projectId: project.id
                    }
                  },
                  create_issue: {
                    name: "create_issue",
                    template: {
                      projectId: project.id,
                      summary: "",
                      issueTypeId: 0,
                      priorityId: 2
                    }
                  }
                }
              }
            }, null, 2)
          }]
        };
      }

      case "get_project_issues": {
        const args = request.params.arguments as unknown as { projectId: number, keyword?: string, statusId?: number };
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
                  tools: {
                    get_issue_details: {
                      name: "get_issue_details",
                      arguments: {
                        issueIdOrKey: issue.id.toString()
                      }
                    },
                    get_issue_comments: {
                      name: "get_issue_comments",
                      arguments: {
                        issueId: issue.id
                      }
                    },
                    create_issue_comment: {
                      name: "create_issue_comment",
                      template: {
                        issueId: issue.id,
                        content: ""
                      }
                    }
                  }
                }
              }))
            }, null, 2)
          }]
        };
      }

      case "get_issue_details": {
        const args = request.params.arguments as unknown as { issueIdOrKey: string };
        if (!args.issueIdOrKey) {
          throw new Error("Missing required argument: issueIdOrKey");
        }

        const issue = await backlogClient.getIssue(args.issueIdOrKey);
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              ...issue,
              _links: {
                tools: {
                  get_issue_comments: {
                    name: "get_issue_comments",
                    arguments: {
                      issueId: issue.id
                    }
                  },
                  create_issue_comment: {
                    name: "create_issue_comment",
                    template: {
                      issueId: issue.id,
                      content: ""
                    }
                  }
                }
              }
            }, null, 2)
          }]
        };
      }

      case "get_issue_comments": {
        const args = request.params.arguments as unknown as { issueId: number };
        if (!args.issueId) {
          throw new Error("Missing required argument: issueId");
        }

        const comments = await backlogClient.getComments(args.issueId);
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              total: comments.length,
              comments: comments.map(comment => ({
                ...comment,
                _links: {
                  tools: {
                    create_issue_comment: {
                      name: "create_issue_comment",
                      template: {
                        issueId: args.issueId,
                        content: ""
                      }
                    }
                  }
                }
              }))
            }, null, 2)
          }]
        };
      }

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
                tools: {
                  get_issue_details: {
                    name: "get_issue_details",
                    arguments: {
                      issueIdOrKey: issue.id.toString()
                    }
                  },
                  get_issue_comments: {
                    name: "get_issue_comments",
                    arguments: {
                      issueId: issue.id
                    }
                  },
                  create_issue_comment: {
                    name: "create_issue_comment",
                    template: {
                      issueId: issue.id,
                      content: ""
                    }
                  }
                }
              }
            }, null, 2)
          }]
        };
      }

      case "create_issue_comment": {
        const args = request.params.arguments as unknown as { issueId: number, content: string };
        if (!args.issueId || !args.content) {
          throw new Error("Missing required arguments for comment creation");
        }

        const comment = await backlogClient.createComment(args.issueId, args.content);
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              ...comment,
              _links: {
                tools: {
                  get_issue_comments: {
                    name: "get_issue_comments",
                    arguments: {
                      issueId: args.issueId
                    }
                  }
                }
              }
            }, null, 2)
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
