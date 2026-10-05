const confidenceLabelSchema = {
  type: "string",
  enum: ["low", "medium", "high"]
};

const SENSITIVE_CONTENT = /\b(religion|religious|faith|church|mosque|temple|synagogue|muslim|christian|jewish|hindu|buddhist|health|medical|diagnos\w*|surgery|disab\w*|trauma\w*|sexual\w*|gay|lesbian|bisexual|transgender|ethnic\w*|race|racial|politic\w*|party|vot\w*)\b/i;
const UNCERTAINTY_LANGUAGE = /\b(may|might|possibly|limited|uncertain|insufficient|cannot|could)\b/i;
const DIRECT_RESTATEMENT_LANGUAGE = /\b(directly|explicitly|straightforward)\b.{0,40}\b(stated|statement|answer)\b/i;

const identityProfileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    supplied_information: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1 },
          category: { type: "string", minLength: 1 },
          statement: { type: "string", minLength: 1 },
          source_answer_id: { type: "string", minLength: 1 }
        },
        required: ["id", "category", "statement", "source_answer_id"]
      }
    },
    inferred_information: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1 },
          statement: { type: "string", minLength: 1 },
          evidence_ids: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 }
          },
          confidence_score: { type: "number", minimum: 0, maximum: 1 },
          confidence_label: confidenceLabelSchema,
          uncertainty_reason: { type: "string", minLength: 1 },
          alternative_interpretation: { type: "string", minLength: 1 }
        },
        required: [
          "id",
          "statement",
          "evidence_ids",
          "confidence_score",
          "confidence_label",
          "uncertainty_reason",
          "alternative_interpretation"
        ]
      }
    },
    generated_assumptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1 },
          statement: { type: "string", minLength: 1 },
          related_evidence_ids: {
            type: "array",
            items: { type: "string", minLength: 1 }
          },
          reason_generated: { type: "string", minLength: 1 },
          risk_level: {
            type: "string",
            enum: ["low", "medium", "high"]
          },
          warning: {
            type: "string",
            enum: ["AI-generated and unverified"]
          }
        },
        required: [
          "id",
          "statement",
          "related_evidence_ids",
          "reason_generated",
          "risk_level",
          "warning"
        ]
      }
    },
    contradictions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          evidence_ids: {
            type: "array",
            minItems: 2,
            items: { type: "string", minLength: 1 }
          },
          description: { type: "string", minLength: 1 },
          possible_explanation: { type: "string", minLength: 1 }
        },
        required: ["evidence_ids", "description", "possible_explanation"]
      }
    },
    unknowns: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    profile_summary: { type: "string", minLength: 1 }
  },
  required: [
    "supplied_information",
    "inferred_information",
    "generated_assumptions",
    "contradictions",
    "unknowns",
    "profile_summary"
  ]
};

const predictionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    target_question: { type: "string", minLength: 1 },
    predicted_response: { type: ["string", "null"] },
    evidence_ids: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    assumptions_used: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    confidence_score: { type: "number", minimum: 0, maximum: 1 },
    confidence_label: confidenceLabelSchema,
    uncertainty_statement: { type: "string", minLength: 1 },
    alternative_possible_response: { type: ["string", "null"] },
    should_ask_participant_instead: { type: "boolean" },
    source_label: {
      type: "string",
      enum: ["AI prediction"]
    }
  },
  required: [
    "target_question",
    "predicted_response",
    "evidence_ids",
    "assumptions_used",
    "confidence_score",
    "confidence_label",
    "uncertainty_statement",
    "alternative_possible_response",
    "should_ask_participant_instead",
    "source_label"
  ]
};

function valueMatchesType(value, expectedType) {
  if (expectedType === "null") return value === null;
  if (expectedType === "array") return Array.isArray(value);
  if (expectedType === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expectedType === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === expectedType;
}

function validateSchema(schema, value, path = "$") {
  const errors = [];
  const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!expectedTypes.some((type) => valueMatchesType(value, type))) {
    return [`${path} must be ${expectedTypes.join(" or ")}.`];
  }

  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} must be one of: ${schema.enum.join(", ")}.`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} is shorter than ${schema.minLength} character(s).`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} is longer than ${schema.maxLength} character(s).`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above ${schema.maximum}.`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item(s).`);
    }
    value.forEach((item, index) => errors.push(...validateSchema(schema.items, item, `${path}[${index}]`)));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const requiredKey of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
        errors.push(`${path}.${requiredKey} is required.`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${path}.${key} is not allowed.`);
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateSchema(propertySchema, value[key], `${path}.${key}`));
      }
    }
  }

  return errors;
}

function expectedConfidenceLabel(score) {
  if (score < 0.4) return "low";
  if (score < 0.75) return "medium";
  return "high";
}

function validateParticipantAnswers(answers) {
  const errors = [];
  if (!Array.isArray(answers) || answers.length === 0) {
    return ["answers must be a non-empty array."];
  }
  if (answers.length > 20) errors.push("answers cannot contain more than 20 items.");

  const ids = new Set();
  answers.forEach((answer, index) => {
    const path = `answers[${index}]`;
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    const keys = Object.keys(answer);
    for (const key of ["id", "question", "answer"]) {
      if (typeof answer[key] !== "string" || !answer[key].trim()) errors.push(`${path}.${key} must be a non-empty string.`);
    }
    for (const key of keys) {
      if (!["id", "question", "answer"].includes(key)) errors.push(`${path}.${key} is not allowed.`);
    }
    if (typeof answer.id === "string") {
      if (ids.has(answer.id)) errors.push(`${path}.id must be unique.`);
      ids.add(answer.id);
    }
  });

  if (JSON.stringify(answers).length > 12_000) errors.push("answers are too large for this prototype.");
  return errors;
}

function validateConfidence(item, path, errors) {
  if (expectedConfidenceLabel(item.confidence_score) !== item.confidence_label) {
    errors.push(`${path}.confidence_label does not match confidence_score.`);
  }
}

function sensitiveAnswerIdsFor(answers) {
  return new Set(
    answers.filter((answer) => SENSITIVE_CONTENT.test(`${answer.question} ${answer.answer}`)).map((answer) => answer.id)
  );
}

function sanitizeIdentityProfile(profile, answers) {
  const sensitiveAnswerIds = sensitiveAnswerIdsFor(answers);
  if (!profile || typeof profile !== "object") {
    return { data: profile, adjustments: [] };
  }

  const adjustments = [];
  const citesSensitiveAnswer = (ids) => Array.isArray(ids) && ids.some((id) => sensitiveAnswerIds.has(id));
  const includesSensitiveExpansion = (item) => SENSITIVE_CONTENT.test(Object.values(item).filter((value) => typeof value === "string").join(" "));
  const originalInferences = Array.isArray(profile.inferred_information) ? profile.inferred_information : [];
  const inferencesWithoutSensitiveExpansion = originalInferences.filter((item) =>
    !citesSensitiveAnswer(item.evidence_ids) && !includesSensitiveExpansion(item)
  );
  const inferredInformation = Array.isArray(profile.inferred_information)
    ? inferencesWithoutSensitiveExpansion.filter((item) =>
        !DIRECT_RESTATEMENT_LANGUAGE.test(Object.values(item).filter((value) => typeof value === "string").join(" "))
      )
    : profile.inferred_information;
  const generatedAssumptions = Array.isArray(profile.generated_assumptions)
    ? profile.generated_assumptions.filter((item) => !citesSensitiveAnswer(item.related_evidence_ids) && !includesSensitiveExpansion(item))
    : profile.generated_assumptions;
  const contradictions = Array.isArray(profile.contradictions)
    ? profile.contradictions.filter((item) => !citesSensitiveAnswer(item.evidence_ids) && !includesSensitiveExpansion(item))
    : profile.contradictions;
  const unknowns = Array.isArray(profile.unknowns)
    ? profile.unknowns.filter((item) => !SENSITIVE_CONTENT.test(item))
    : profile.unknowns;

  if (inferencesWithoutSensitiveExpansion.length !== originalInferences.length) {
    adjustments.push("Removed model inferences that used or generated sensitive information.");
  }
  if (inferredInformation.length !== inferencesWithoutSensitiveExpansion.length) {
    adjustments.push("Removed model inferences that merely restated supplied information.");
  }
  if (generatedAssumptions.length !== profile.generated_assumptions.length) {
    adjustments.push("Removed model assumptions that used or generated sensitive information.");
  }
  if (contradictions.length !== profile.contradictions.length) {
    adjustments.push("Removed model contradictions that used or generated sensitive information.");
  }
  if (unknowns.length !== profile.unknowns.length) {
    adjustments.push("Removed model unknowns that used or generated sensitive information.");
  }

  let profileSummary = profile.profile_summary;
  if (typeof profileSummary === "string" && SENSITIVE_CONTENT.test(profileSummary)) {
    profileSummary = "This temporary algorithmic profile is based on limited supplied information and does not represent the participant's complete or authentic identity.";
    adjustments.push("Replaced a profile summary that used or generated sensitive information.");
  }

  return {
    data: {
      ...profile,
      inferred_information: inferredInformation,
      generated_assumptions: generatedAssumptions,
      contradictions,
      unknowns,
      profile_summary: profileSummary
    },
    adjustments
  };
}

function validateIdentityProfile(profile, answers) {
  const errors = validateSchema(identityProfileSchema, profile);
  if (errors.length) return errors;

  const answerById = new Map(answers.map((answer) => [answer.id, answer]));
  const sensitiveAnswerIds = sensitiveAnswerIdsFor(answers);
  const outputIds = new Set();
  const addUniqueId = (id, path) => {
    if (outputIds.has(id)) errors.push(`${path}.id must be unique across the profile.`);
    outputIds.add(id);
  };

  profile.supplied_information.forEach((item, index) => {
    const path = `$.supplied_information[${index}]`;
    addUniqueId(item.id, path);
    const answer = answerById.get(item.source_answer_id);
    if (!answer) errors.push(`${path}.source_answer_id does not reference an input answer.`);
    if (answer && item.statement !== answer.answer) errors.push(`${path}.statement must copy the source answer exactly.`);
  });

  if (profile.supplied_information.length !== answers.length) {
    errors.push("$.supplied_information must contain exactly one item for each input answer.");
  }

  profile.inferred_information.forEach((item, index) => {
    const path = `$.inferred_information[${index}]`;
    addUniqueId(item.id, path);
    validateConfidence(item, path, errors);
    item.evidence_ids.forEach((id) => {
      if (!answerById.has(id)) errors.push(`${path}.evidence_ids contains an unknown answer ID.`);
      if (sensitiveAnswerIds.has(id)) errors.push(`${path}.evidence_ids must not cite explicitly supplied sensitive information.`);
    });
  });

  profile.generated_assumptions.forEach((item, index) => {
    const path = `$.generated_assumptions[${index}]`;
    addUniqueId(item.id, path);
    item.related_evidence_ids.forEach((id) => {
      if (!answerById.has(id)) errors.push(`${path}.related_evidence_ids contains an unknown answer ID.`);
      if (sensitiveAnswerIds.has(id)) errors.push(`${path}.related_evidence_ids must not cite explicitly supplied sensitive information.`);
    });
  });

  profile.contradictions.forEach((item, index) => {
    item.evidence_ids.forEach((id) => {
      if (!answerById.has(id)) errors.push(`$.contradictions[${index}].evidence_ids contains an unknown answer ID.`);
      if (sensitiveAnswerIds.has(id)) errors.push(`$.contradictions[${index}].evidence_ids must not cite explicitly supplied sensitive information.`);
    });
  });

  return errors;
}

function validatePrediction(prediction, answers, profile) {
  const errors = validateSchema(predictionSchema, prediction);
  if (errors.length) return errors;

  const answerIds = new Set(answers.map((answer) => answer.id));
  const sensitiveAnswerIds = sensitiveAnswerIdsFor(answers);
  const assumptionIds = new Set(profile.generated_assumptions.map((item) => item.id));
  prediction.evidence_ids.forEach((id) => {
    if (!answerIds.has(id)) errors.push("$.evidence_ids contains an unknown answer ID.");
    if (sensitiveAnswerIds.has(id)) errors.push("$.evidence_ids must not cite explicitly supplied sensitive information.");
  });
  prediction.assumptions_used.forEach((id) => {
    if (!assumptionIds.has(id)) errors.push("$.assumptions_used contains an unknown generated-assumption ID.");
  });
  validateConfidence(prediction, "$", errors);

  if ((prediction.predicted_response === null) !== prediction.should_ask_participant_instead) {
    errors.push("$.predicted_response must be null exactly when $.should_ask_participant_instead is true.");
  }

  if (!UNCERTAINTY_LANGUAGE.test(prediction.uncertainty_statement)) {
    errors.push("$.uncertainty_statement must use explicit uncertainty language.");
  }

  if (prediction.predicted_response === null && prediction.confidence_score >= 0.4) {
    errors.push("$.confidence_score must be low when predicted_response is null.");
  }

  const usesContradictoryEvidence = profile.contradictions.some((contradiction) => {
    const usedIds = contradiction.evidence_ids.filter((id) => prediction.evidence_ids.includes(id));
    return usedIds.length >= 2;
  });
  if (usesContradictoryEvidence && prediction.predicted_response !== null) {
    errors.push("$.predicted_response must be null when the prediction relies on contradictory evidence.");
  }

  if (SENSITIVE_CONTENT.test(prediction.target_question)) {
    if (prediction.predicted_response !== null) errors.push("$.predicted_response must be null for a sensitive target question.");
    if (prediction.evidence_ids.length) errors.push("$.evidence_ids must be empty for a sensitive target question.");
    if (prediction.assumptions_used.length) errors.push("$.assumptions_used must be empty for a sensitive target question.");
    if (!prediction.should_ask_participant_instead) errors.push("$.should_ask_participant_instead must be true for a sensitive target question.");
  }

  return errors;
}

module.exports = {
  identityProfileSchema,
  predictionSchema,
  sanitizeIdentityProfile,
  validateIdentityProfile,
  validateParticipantAnswers,
  validatePrediction,
  validateSchema
};
