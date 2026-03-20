import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import { PDFParse } from "pdf-parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMBEDDING_MODEL = "gemini-embedding-001";
const REQUIRED_DIMENSION = 3072;
const POLICIES_DIR = path.join(__dirname, "data", "policies");

function validateEnvironment() {
  const requiredVars = ["GOOGLE_API_KEY", "PINECONE_API_KEY", "PINECONE_INDEX_NAME"];
  const missingVars = requiredVars.filter((key) => !process.env[key]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
  }
}

function createEmbeddingsModel() {
  return new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY,
    modelName: EMBEDDING_MODEL,
    maxConcurrency: 1,
  });
}

/**
 * Scans the data/policies directory for TXT and PDF files.
 */
async function resolveSourceTexts() {
  const documents = [];
  
  try {
    const stats = await fs.stat(POLICIES_DIR);
    if (!stats.isDirectory()) {
        throw new Error("Policies path is not a directory");
    }
  } catch (e) {
    console.warn(`[INGEST] Warning: Policies directory not found or inaccessible at ${POLICIES_DIR}`);
    return [];
  }

  const files = await fs.readdir(POLICIES_DIR);
  console.log(`[INGEST] Scanning ${files.length} files in policies directory...`);

  for (const file of files) {
    const filePath = path.join(POLICIES_DIR, file);
    const ext = path.extname(file).toLowerCase();

    try {
      if (ext === ".txt") {
        const text = await fs.readFile(filePath, "utf-8");
        documents.push({ text, source: file });
        console.log(`[INGEST] Loaded text file: ${file}`);
      } else if (ext === ".pdf") {
        const dataBuffer = await fs.readFile(filePath);
        const parser = new PDFParse({ data: dataBuffer });
        const result = await parser.getText();
        documents.push({ text: result.text, source: file });
        console.log(`[INGEST] Loaded PDF file: ${file}`);
      }
    } catch (err) {
      console.error(`[INGEST] Error loading file ${file}:`, err.message);
    }
  }

  return documents;
}

export async function ingestKnowledge({ text, namespace = "default" } = {}) {
  validateEnvironment();

  try {
    const pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    const indexName = process.env.PINECONE_INDEX_NAME;
    const index = pc.Index(indexName);

    // 1. Get source documents
    let sourceDocs = [];
    if (text) {
      sourceDocs.push({ text, source: "direct_input" });
    } else {
      sourceDocs = await resolveSourceTexts();
    }

    if (sourceDocs.length === 0) {
      return { success: false, message: "No content found to ingest in data/policies." };
    }

    // 2. Chunking
    const embeddings = createEmbeddingsModel();
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    let allChunks = [];
    for (const doc of sourceDocs) {
      const splitDocs = await textSplitter.createDocuments(
        [doc.text], 
        [{ source: doc.source, ingestedAt: new Date().toISOString() }]
      );
      allChunks.push(...splitDocs);
    }

    console.log(`[INGEST] Total chunks to process: ${allChunks.length}`);

    if (allChunks.length === 0) {
      throw new Error("No text chunks generated from the sources.");
    }

    // 3. Verify embedding dimension
    const previewEmbedding = await embeddings.embedQuery(allChunks[0].pageContent);
    console.log(`[INGEST] Embedding dimension verification: ${previewEmbedding.length}`);
    
    if (previewEmbedding.length !== REQUIRED_DIMENSION) {
        throw new Error(`Embedding dimension mismatch. Expected ${REQUIRED_DIMENSION}, received ${previewEmbedding.length}.`);
    }

    // 4. Clear existing data in the namespace to avoid stale context
    console.log(`[INGEST] Clearing existing data in namespace: ${namespace}...`);
    try {
      await index.namespace(namespace).deleteAll();
    } catch (e) {
      console.warn("[INGEST] Namespace might be empty or deletion failed, continuing...");
    }

    // 5. Upsert to Pinecone
    await PineconeStore.fromDocuments(allChunks, embeddings, {
      pineconeIndex: index,
      namespace: namespace,
      textKey: "text",
    });

    return {
      success: true,
      message: `Knowledge base ingested successfully. Uploaded ${allChunks.length} chunks from ${sourceDocs.length} source(s).`,
      uploadedCount: allChunks.length,
      embeddingLength: previewEmbedding.length,
      sources: sourceDocs.map(d => d.source)
    };
  } catch (error) {
    console.error("[INGEST] Error:", error);
    throw error;
  }
}

export { REQUIRED_DIMENSION };
