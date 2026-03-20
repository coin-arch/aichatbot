import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve("d:/COMPANY WORK/aichatbot/apichat2/.env") });

async function recreateIndex() {
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });

  const indexName = process.env.PINECONE_INDEX_NAME;
  const targetDimension = 3072;

  console.log(`Checking existing index: ${indexName}...`);
  try {
    const existingIndex = await pinecone.describeIndex(indexName);
    console.log(`Current index dimensions: ${existingIndex.dimension}`);

    if (existingIndex.dimension !== targetDimension) {
      console.log(`Dimensions do not match. Deleting index ${indexName}...`);
      await pinecone.deleteIndex(indexName);
      console.log(`Waiting for deletion to propagate...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      
      console.log(`Creating new index ${indexName} with dimension ${targetDimension}...`);
      await pinecone.createIndex({
        name: indexName,
        dimension: targetDimension,
        metric: "cosine",
        spec: {
          serverless: {
            cloud: "aws",
            region: "us-east-1"
          }
        }
      });
      console.log("Index successfully recreated!");
    } else {
      console.log("Index is already correct!");
    }
  } catch (error) {
    if (error.name === "PineconeNotFoundError" || error.message.includes("not found")) {
      console.log(`Index does not exist. Creating new index ${indexName}...`);
      await pinecone.createIndex({
        name: indexName,
        dimension: targetDimension,
        metric: "cosine",
        spec: {
          serverless: {
            cloud: "aws",
            region: "us-east-1"
          }
        }
      });
      console.log("Index successfully created!");
    } else {
      console.error("An unexpected error occurred:", error);
    }
  }
}

recreateIndex().catch(console.error);
