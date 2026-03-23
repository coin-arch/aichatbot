import path from "node:path";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import { ingestKnowledge, REQUIRED_DIMENSION } from "./ingest.js";

dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 5000);
const namespace = process.env.PINECONE_NAMESPACE || "default";

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.send("<h1>SSP Agarbatti AI Support System</h1><p>Status: Online & Ready</p>");
});

function validateEnvironment() {
  const requiredVars = ["GOOGLE_API_KEY", "PINECONE_API_KEY", "PINECONE_INDEX_NAME"];
  const missingVars = requiredVars.filter((key) => !process.env[key]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
  }
}

async function createVectorStore() {
  validateEnvironment();

  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });

  const indexDescription = await pinecone.describeIndex(process.env.PINECONE_INDEX_NAME);
  if (indexDescription.dimension !== REQUIRED_DIMENSION) {
    throw new Error(
      `Pinecone index dimension mismatch. Expected ${REQUIRED_DIMENSION}, received ${indexDescription.dimension}.`
    );
  }

  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY,
    modelName: "gemini-embedding-001",
    maxConcurrency: 1,
  });

  return PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex: pinecone.index(process.env.PINECONE_INDEX_NAME),
    namespace,
    maxConcurrency: 1,
  });
}

function formatDocuments(documents) {
  return documents
    .map((doc, index) => {
      const source = doc.metadata?.source || "unknown";
      return `Chunk ${index + 1} (source: ${source}): ${doc.pageContent}`;
    })
    .join("\n\n");
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "rag-chatbot-backend",
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/ingest", async (req, res) => {
  try {
    const result = await ingestKnowledge({
      text: req.body?.text,
      filePath: req.body?.filePath,
      namespace,
    });

    res.json(result);
  } catch (error) {
    console.error("[INGEST] Failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to ingest knowledge.",
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const question = req.body?.question?.trim();
    if (!question) {
      return res.status(400).json({
        success: false,
        error: "Question is required.",
      });
    }

    console.log(`[CHAT] Question received: ${question}`);

    const vectorStore = await createVectorStore();
    const retriever = vectorStore.asRetriever({ k: 5 });
    const retrievedDocs = await retriever.invoke(question);

    console.log(`[CHAT] Retrieved ${retrievedDocs.length} chunks from Pinecone.`);

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are a professional and friendly Customer Support Assistant for BarterBuild. 
        Your goal is to answer questions about real estate barter, user verification, and platform policies based ONLY on the provided context.
        
        Rules:
        1. Only use the provided context to answer.
        2. If you don't know the answer, say: "I'm sorry, I couldn't find information on that in our records. Please contact BarterBuild support for further assistance."
        3. Formatting: Use bullet points, numbered lists, and **bolding** for better readability. Avoid long paragraphs.
        4. Be concise, polite, and professional.
        
        Context: {context}`,
      ],
      ["human", "{question}"],
    ]);

    console.log(`[CHAT] Initializing with model: ${"gemini-flash-latest"}`);
    const model = new ChatGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_API_KEY,
      model: "gemini-flash-latest",
      convertSystemMessageToHumanContent: true,
      temperature: 0,
      maxRetries: 2,
    });

    const chain = RunnableSequence.from([
      {
        question: (input) => input.question,
        context: (input) => formatDocuments(input.documents),
      },
      prompt,
      model,
      new StringOutputParser(),
    ]);

    const answer =
      retrievedDocs.length === 0
        ? "I could not find that answer in the knowledge base."
        : await chain.invoke({
            question,
            documents: retrievedDocs,
          });

    res.json({
      success: true,
      answer,
      sources: retrievedDocs.map((doc, index) => ({
        id: index + 1,
        source: doc.metadata?.source || "unknown",
        preview: doc.pageContent.slice(0, 140),
      })),
    });
  } catch (error) {
    console.error(`[CHAT] Error for question "${req.body?.question}":`, error);
    
    // Check for specific Gemini errors
    let errorMessage = "We're sorry, but our support assistant is currently unavailable. Please try your question again in a moment.";
    let statusCode = 500;

    if (error.message?.includes("404") || error.message?.includes("not found")) {
      errorMessage = "The AI model configuration is incorrect or the model is unavailable. (Error 404)";
    } else if (error.message?.includes("429") || error.message?.includes("quota")) {
      errorMessage = "Our support assistant is currently experiencing exceptionally high demand. Please wait a moment and try your question again. We appreciate your patience!";
      statusCode = 429;
    } else if (error.message?.includes("API key")) {
      errorMessage = "Invalid API configuration. Please check your settings.";
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found.",
  });
});

app.listen(port, () => {
  console.log(`[SERVER] Backend running on http://localhost:${port}`);
  console.log(`[SERVER] Policy documents scanning: ${path.resolve("data", "policies")}`);
  console.log(`[SERVER] Using model: gemini-flash-latest`);
});
