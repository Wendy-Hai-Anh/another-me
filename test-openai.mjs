import process from "node:process";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ path: ".env.local", quiet: true });

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OpenAI API key was not found.");
}

const client = new OpenAI({ apiKey });

async function main() {
  console.log("Sending participant information to OpenAI...");

  const response = await client.responses.create({
    model: "gpt-5.6-luna",
    store: false,

    instructions: `
You are the interpretive layer for an experimental project called Another Me.

Construct an intentionally provisional interpretation from limited participant data.

Clearly separate:
1. SUPPLIED — facts directly stated by the participant.
2. INFERRED — reasonable interpretations based on those facts.
3. GENERATED — plausible but unsupported assumptions.

Do not present inferences as facts.
Do not infer sensitive traits such as health, ethnicity, sexuality,
religion or politics unless the participant explicitly supplied them.
Keep the result short and suitable for spoken delivery.
`,

    input: `
Participant information:

Name: Wendy
Memory: I often kept photographs because I was afraid of forgetting important moments.
Preference: I prefer quiet environments to crowded places.

Create a short identity interpretation and one prediction about
how this participant might respond to change.
`,
  });

  console.log("\nOpenAI response:\n");
  console.log(response.output_text);
}

main().catch((error) => {
  console.error(error.message);
});