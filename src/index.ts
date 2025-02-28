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
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from 'dotenv';
import { BacklogClient } from './services/backlog-client.js';

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
      tools: {},
      prompts: {},
    },
  }
);

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
    throw new Error('Failed to fetch Backlog resources');
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
          throw new Error('Project ID is required');
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
          try {
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
          } catch (error) {
            console.error('Error fetching issues:', error);
            throw new Error(`Failed to fetch issues for project ${projectId}`);
          }
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
      throw new Error(`Resource ${request.params.uri} not found`);
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
    throw new Error(`Failed to read resource ${request.params.uri}`);
  }
});

/**
 * Handler that lists available tools.
 * Exposes a single "create_note" tool that lets clients create new notes.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_note",
        description: "Create a new note",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Title of the note"
            },
            content: {
              type: "string",
              description: "Text content of the note"
            }
          },
          required: ["title", "content"]
        }
      }
    ]
  };
});

/**
 * Handler for the create_note tool.
 * Creates a new note with the provided title and content, and returns success message.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "create_note": {
      const title = String(request.params.arguments?.title);
      const content = String(request.params.arguments?.content);
      if (!title || !content) {
        throw new Error("Title and content are required");
      }

      const id = String(Object.keys(notes).length + 1);
      notes[id] = { title, content };

      return {
        content: [{
          type: "text",
          text: `Created note ${id}: ${title}`
        }]
      };
    }

    default:
      throw new Error("Unknown tool");
  }
});

/**
 * Handler that lists available prompts.
 * Exposes a single "summarize_notes" prompt that summarizes all notes.
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "summarize_notes",
        description: "Summarize all notes",
      }
    ]
  };
});

/**
 * Handler for the summarize_notes prompt.
 * Returns a prompt that requests summarization of all notes, with the notes' contents embedded as resources.
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "summarize_notes") {
    throw new Error("Unknown prompt");
  }

  const embeddedNotes = Object.entries(notes).map(([id, note]) => ({
    type: "resource" as const,
    resource: {
      uri: `note:///${id}`,
      mimeType: "text/plain",
      text: note.content
    }
  }));

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Please summarize the following notes:"
        }
      },
      ...embeddedNotes.map(note => ({
        role: "user" as const,
        content: note
      })),
      {
        role: "user",
        content: {
          type: "text",
          text: "Provide a concise summary of all the notes above."
        }
      }
    ]
  };
});

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
