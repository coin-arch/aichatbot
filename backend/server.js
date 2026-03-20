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

    const model = new ChatGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_API_KEY,
      model: "gemini-flash-latest",
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
    console.error("[CHAT] Failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to answer question.",
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
});
