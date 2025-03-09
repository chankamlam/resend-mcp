#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { 
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
 } from "@modelcontextprotocol/sdk/types.js";
import { Resend } from "resend";

// Get API key from environment variable
const RESEND_API_KEY = process.env.RESEND_API_KEY!;
if (!RESEND_API_KEY) {
  console.error("Error: RESEND_API_KEY environment variable is required");
  process.exit(1);
}

// Get optional sender email from environment variable
const SENDER_EMAIL = process.env.SENDER_EMAIL;

// Get optional reply-to emails from environment variable
const REPLY_TO_EMAILS = process.env.REPLY_TO_EMAILS ? 
  process.env.REPLY_TO_EMAILS.split(",") : [];

// Initialize Resend client
const resend = new Resend(RESEND_API_KEY);

// Define email sending tool
const SEND_EMAIL_TOOL: Tool = {
  name: "send_email",
  description:
    "Sends an email using the Resend API. " +
    "Supports plain text content and optional scheduling. " +
    "Can specify custom sender and reply-to addresses if not configured via environment variables.",
  inputSchema: {
    type: "object",
    properties: {
      to: {
        type: "string",
        format: "email",
        description: "Recipient email address"
      },
      subject: {
        type: "string",
        description: "Email subject line"
      },
      content: {
        type: "string",
        description: "Plain text email content"
      },
      from: {
        type: "string",
        format: "email",
        description: "Sender email address (required if SENDER_EMAIL not set)"
      },
      replyTo: {
        type: "array",
        items: {
          type: "string",
          format: "email"
        },
        description: "Reply-to email addresses (optional if REPLY_TO_EMAILS not set)"
      },
      scheduledAt: {
        type: "string",
        description: "Optional parameter to schedule the email. This uses natural language. Examples would be 'tomorrow at 10am' or 'in 2 hours' or 'next day at 9am PST' or 'Friday at 3pm ET'."
      }
    },
    required: ["to", "subject", "content"]
  }
};

// Type guard for email args
function isEmailArgs(args: unknown): args is {
  to: string;
  subject: string;
  content: string;
  from?: string;
  replyTo?: string[];
  scheduledAt?: string;
} {
  return (
    typeof args === "object" &&
    args !== null &&
    "to" in args &&
    typeof (args as { to: string }).to === "string" &&
    "subject" in args &&
    typeof (args as { subject: string }).subject === "string" &&
    "content" in args &&
    typeof (args as { content: string }).content === "string"
  );
}

// Server implementation
const server = new Server(
  {
    name: "resend-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [SEND_EMAIL_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error("No arguments provided");
    }

    switch (name) {
      case SEND_EMAIL_TOOL.name: {
        if (!isEmailArgs(args)) {
          throw new Error("Invalid arguments for send_email tool");
        }

        const fromEmail = args.from || SENDER_EMAIL;
        if (!fromEmail) {
          throw new Error("Sender email must be provided either via args or SENDER_EMAIL environment variable");
        }

        const replyToEmails = args.replyTo || REPLY_TO_EMAILS;

        const response = await resend.emails.send({
          to: args.to,
          from: fromEmail,
          subject: args.subject,
          text: args.content,
          replyTo: replyToEmails,
          scheduledAt: args.scheduledAt
        });

        if (response.error) {
          throw new Error(`Failed to send email: ${JSON.stringify(response.error)}`);
        }

        return {
          content: [{
            type: "text",
            text: `Email sent successfully! ${JSON.stringify(response.data)}`
          }]
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
      isError: true,
    };
  }
});

// Start server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Resend MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
