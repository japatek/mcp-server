import express, { Request, Response } from "express";
import cors from "cors";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8080;
const NEXTJS_SERVICE_URL = process.env.NEXTJS_SERVICE_URL || "https://japatek.space";

// Standard MCP Server initialization
function createMcpServer() {
  const server = new Server(
    { name: "japatek-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // List available tools exposed by this MCP server
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "calculate_area",
          description: "Calculates the area of geometric shapes (rectangle, circle, or triangle).",
          inputSchema: {
            type: "object",
            properties: {
              shape: {
                type: "string",
                enum: ["rectangle", "circle", "triangle"],
                description: "The shape to calculate area for.",
              },
              length: { type: "number", description: "Length (required for rectangle)" },
              width: { type: "number", description: "Width (required for rectangle)" },
              radius: { type: "number", description: "Radius (required for circle)" },
              base: { type: "number", description: "Base (required for triangle)" },
              height: { type: "number", description: "Height (required for triangle)" },
            },
            required: ["shape"],
          },
        },
        {
          name: "calculate_beam_load",
          description: "Calculates structural beam load parameters.",
          inputSchema: {
            type: "object",
            properties: {
              length: { type: "number", description: "Length of the beam in meters" },
              load: { type: "number", description: "Uniformly distributed load in kN/m" },
            },
            required: ["length", "load"],
          },
        },
      ],
    };
  });

  // Execute tool logic
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = (request.params.arguments || {}) as Record<string, any>;

    // 1. Calculate Area Tool Logic
    if (toolName === "calculate_area") {
      const shape = String(args.shape).toLowerCase();
      let area = 0;
      let formulaDetails = "";

      switch (shape) {
        case "rectangle":
          if (typeof args.length !== "number" || typeof args.width !== "number") {
            throw new Error("Rectangle calculation requires numeric 'length' and 'width'.");
          }
          area = args.length * args.width;
          formulaDetails = `Length (${args.length}) × Width (${args.width})`;
          break;

        case "circle":
          if (typeof args.radius !== "number") {
            throw new Error("Circle calculation requires numeric 'radius'.");
          }
          area = Math.PI * Math.pow(args.radius, 2);
          formulaDetails = `π × Radius (${args.radius})²`;
          break;

        case "triangle":
          if (typeof args.base !== "number" || typeof args.height !== "number") {
            throw new Error("Triangle calculation requires numeric 'base' and 'height'.");
          }
          area = 0.5 * args.base * args.height;
          formulaDetails = `0.5 × Base (${args.base}) × Height (${args.height})`;
          break;

        default:
          throw new Error(`Unsupported shape: '${shape}'. Supported shapes are rectangle, circle, and triangle.`);
      }

      return {
        content: [
          {
            type: "text",
            text: `Area of ${shape}: ${area.toFixed(4)} sq units\nCalculation: ${formulaDetails}`,
          },
        ],
      };
    }

    // 2. Calculate Beam Load Tool Logic
    if (toolName === "calculate_beam_load") {
      const { length, load } = args as { length: number; load: number };
      const maxBendingMoment = (load * Math.pow(length, 2)) / 8;

      return {
        content: [
          {
            type: "text",
            text: `Max Bending Moment (M_max): ${maxBendingMoment} kNm`,
          },
        ],
      };
    }

    throw new Error(`Tool not found: ${toolName}`);
  });

  return server;
}

// Track active SSE transports
const transports = new Map<string, SSEServerTransport>();

// SSE Connection Endpoint
app.get("/mcp", async (req: Request, res: Response) => {
  const token = req.query.token as string;

  if (!token) {
    res.status(401).send("Unauthorized: License token is required.");
    return;
  }

  // Validate token via Next.js internal Service
  try {
    const authRes = await fetch(`${NEXTJS_SERVICE_URL}/api/verify-license?token=${token}`);
    if (!authRes.ok) {
      res.status(403).send("Forbidden: Invalid or expired license key.");
      return;
    }
  } catch (err) {
    console.error("License verification failed:", err);
    res.status(500).send("Internal authentication error.");
    return;
  }

  // Initialize SSE Transport
  const transport = new SSEServerTransport("/mcp/messages", res);
  const server = createMcpServer();

  transports.set(transport.sessionId, transport);

  transport.onclose = () => {
    transports.delete(transport.sessionId);
  };

  await server.connect(transport);
});

// MCP Client Message Endpoint
app.post("/mcp/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (!transport) {
    res.status(404).send("Session expired or not found.");
    return;
  }

  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});