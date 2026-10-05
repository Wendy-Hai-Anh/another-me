const path = require("node:path");

const OpenAI = require("openai").default;

const {
  identityProfileSchema,
  predictionSchema,
  sanitizeIdentityProfile,
  validateIdentityProfile,
  validateParticipantAnswers,
  validatePrediction,
  validateSchema
} = require("./schemas.cjs");
const { PROFILE_CONSTRUCTION_PROMPT, PREDICTION_PROMPT } = require("./prompts.cjs");

require("dotenv").config({
  path: path.resolve(__dirname, "..", "..", "..", ".env.local"),
  quiet: true
});

const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const REQUEST_TIMEOUT_MS = 90_000;

class IdentityLogicError extends Error {
  constructor(code, message, statusCode = 500, details = []) {
    super(message);
    this.name = "IdentityLogicError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function requireApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new IdentityLogicError(
      "missing_api_key",
      "OPENAI_API_KEY is not configured on the server.",
      503
    );
  }
}

function findRefusal(response) {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") return content.refusal || "The model refused this request.";
    }
  }
  return "";
}

function mapApiError(error) {
  if (
    error.name === "AbortError" ||
    error.name === "APIConnectionError" ||
    error.name === "APIConnectionTimeoutError" ||
    error.name === "APIUserAbortError"
  ) {
    return new IdentityLogicError("openai_network_failure", "The server could not reach OpenAI.", 504);
  }
  if (error.status === 401 || error.status === 403) {
    return new IdentityLogicError("invalid_api_key", "OpenAI rejected the server credentials.", 502);
  }
  if (error.status === 429) {
    return new IdentityLogicError("openai_quota_exceeded", "OpenAI quota is unavailable.", 503);
  }
  return new IdentityLogicError("openai_api_failure", "OpenAI could not complete the request.", 502);
}

async function createStructuredOutput({ instructions, input, name, schema, validate, transform, maxOutputTokens }) {
  requireApiKey();
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS
  });
  const startedAt = performance.now();
  let validationFeedback = [];

  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const requestInput = validationFeedback.length
        ? {
            ...input,
            correction_required: {
              instruction: "Generate a fresh result that fixes every validation error. Do not repeat the rejected behavior.",
              validation_errors: validationFeedback
            }
          }
        : input;

      let response;
      try {
        response = await client.responses.create({
          model: MODEL,
          instructions,
          input: JSON.stringify(requestInput),
          max_output_tokens: maxOutputTokens,
          store: false,
          text: {
            format: {
              type: "json_schema",
              name,
              strict: true,
              schema
            }
          }
        }, {
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const refusal = findRefusal(response);
      if (refusal) {
        throw new IdentityLogicError("model_refusal", "The model refused this request.", 422);
      }
      if (response.status !== "completed") {
        throw new IdentityLogicError(
          "incomplete_output",
          "The model response was incomplete.",
          502,
          response.incomplete_details ? [JSON.stringify(response.incomplete_details)] : []
        );
      }
      if (!response.output_text) {
        throw new IdentityLogicError("empty_model_output", "The model returned no structured output.", 502);
      }

      let parsed;
      try {
        parsed = JSON.parse(response.output_text);
      } catch {
        throw new IdentityLogicError("invalid_model_json", "The model returned invalid JSON.", 502);
      }

      const structuralErrors = validateSchema(schema, parsed);
      if (structuralErrors.length) {
        validationFeedback = structuralErrors.slice(0, 12);
        if (attempt < 2) continue;
        throw new IdentityLogicError(
          "invalid_model_output",
          "The model output failed local schema validation.",
          502,
          validationFeedback
        );
      }

      const transformed = transform ? transform(parsed) : { data: parsed, adjustments: [] };
      const validationErrors = validate(transformed.data);
      if (validationErrors.length) {
        validationFeedback = validationErrors.slice(0, 12);
        if (attempt < 2) continue;
        throw new IdentityLogicError(
          "invalid_model_output",
          "The model output failed local schema validation.",
          502,
          validationFeedback
        );
      }

      return {
        data: transformed.data,
        meta: {
          model: response.model || MODEL,
          response_time_ms: Math.round(performance.now() - startedAt),
          attempts: attempt,
          safety_adjustments: transformed.adjustments
        }
      };
    }

    throw new IdentityLogicError("invalid_model_output", "The model output failed local schema validation.", 502);
  } catch (error) {
    if (error instanceof IdentityLogicError) throw error;
    throw mapApiError(error);
  }
}

async function createIdentityProfile(answers) {
  const inputErrors = validateParticipantAnswers(answers);
  if (inputErrors.length) {
    throw new IdentityLogicError("invalid_input", "Participant answers are invalid.", 400, inputErrors);
  }

  return createStructuredOutput({
    instructions: PROFILE_CONSTRUCTION_PROMPT,
    input: { participant_answers: answers },
    name: "identity_profile",
    schema: identityProfileSchema,
    transform: (profile) => sanitizeIdentityProfile(profile, answers),
    validate: (profile) => validateIdentityProfile(profile, answers),
    maxOutputTokens: 3_500
  });
}

async function createPrediction({ answers, profile, targetQuestion }) {
  const inputErrors = validateParticipantAnswers(answers);
  if (inputErrors.length) {
    throw new IdentityLogicError("invalid_input", "Participant answers are invalid.", 400, inputErrors);
  }
  if (typeof targetQuestion !== "string" || !targetQuestion.trim() || targetQuestion.length > 1_000) {
    throw new IdentityLogicError("invalid_input", "The target question must be a non-empty string.", 400);
  }

  const profileErrors = validateIdentityProfile(profile, answers);
  if (profileErrors.length) {
    throw new IdentityLogicError("invalid_profile", "The supplied identity profile is invalid.", 400, profileErrors);
  }

  return createStructuredOutput({
    instructions: PREDICTION_PROMPT,
    input: {
      participant_answers: answers,
      identity_profile: profile,
      target_question: targetQuestion
    },
    name: "identity_prediction",
    schema: predictionSchema,
    validate: (prediction) => {
      const errors = validatePrediction(prediction, answers, profile);
      if (prediction.target_question !== targetQuestion) {
        errors.push("$.target_question must copy the requested target question exactly.");
      }
      return errors;
    },
    maxOutputTokens: 1_500
  });
}

module.exports = {
  IdentityLogicError,
  MODEL,
  createIdentityProfile,
  createPrediction
};
