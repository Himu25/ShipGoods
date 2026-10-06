import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAQ_PATH = path.resolve(__dirname, "../knowledge/pickup-faq.md");

async function main() {
  const apiKey = process.env.XAI_API_KEY;
  const managementKey =
    process.env.XAI_MANAGEMENT_API_KEY || process.env.XAI_API_KEY;
  if (!apiKey) {
    console.error("Set XAI_API_KEY in server/.env");
    process.exit(1);
  }

  const faq = fs.readFileSync(FAQ_PATH);
  const collectionName = "shipgoods-pickup-faq";

  const createRes = await fetch("https://management-api.x.ai/v1/collections", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${managementKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ collection_name: collectionName }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    console.error("Failed to create collection:", createRes.status, body);
    process.exit(1);
  }

  const created = await createRes.json();
  const collectionId = created.collection_id || created.id;
  console.log("Collection:", collectionId);

  const form = new FormData();
  form.append("name", "pickup-faq.md");
  form.append("content_type", "text/markdown");
  form.append("data", new Blob([faq], { type: "text/markdown" }), "pickup-faq.md");

  const uploadRes = await fetch(
    `https://management-api.x.ai/v1/collections/${collectionId}/documents`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${managementKey}` },
      body: form,
    }
  );

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    console.error("Failed to upload FAQ:", uploadRes.status, body);
    process.exit(1);
  }

  console.log("Uploaded pickup-faq.md");
  console.log(`Add this to server/.env:\nXAI_RAG_COLLECTION_ID=${collectionId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
