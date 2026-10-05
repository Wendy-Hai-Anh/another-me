// Public diagnostics never include raw vendor messages, request bodies, or credentials.
const identityMessages = {
  missing_api_key: "OpenAI credentials are not configured on the server.",
  invalid_api_key: "OpenAI rejected the server credentials or project access.",
  openai_quota_exceeded: "OpenAI quota is unavailable. Check API billing or usage limits.",
  openai_network_failure: "The server could not connect to OpenAI. Retry when the connection is available.",
  openai_api_failure: "OpenAI could not complete this request. Your previous result is unchanged.",
  incomplete_output: "OpenAI returned an incomplete profile. Your answers and previous profile are unchanged; please retry.",
  empty_model_output: "OpenAI returned no profile. Your previous profile is unchanged.",
  invalid_model_json: "OpenAI returned invalid structured output. Please retry.",
  invalid_model_output: "The profile failed its evidence or format checks. Your previous profile is unchanged; please retry.",
  model_refusal: "OpenAI declined this request. You can revise your answers or skip.",
  timeout: "The request reached its time limit. Your information is unchanged; retry or skip.",
  cancelled: "The request was cancelled. Your information is unchanged."
};
function safeError(error) {
  if (error.publicMessage) return [error.statusCode || 502, error.publicMessage];
  if (identityMessages[error.code]) return [error.statusCode || 502, identityMessages[error.code]];
  if (error.statusCode && error.statusCode < 500) return [error.statusCode, "The request could not be accepted. Review the required inputs."];
  if ([401, 403].includes(error.status)) return [503, identityMessages.invalid_api_key];
  if (error.status === 429) return [503, identityMessages.openai_quota_exceeded];
  return [502, "The provider could not complete the request. Your information is unchanged."];
}
function diagnosticCode(error) {
  return /^[a-z][a-z0-9_]{1,64}$/.test(error.code || "") ? error.code : "service_error";
}
module.exports = { safeError, diagnosticCode };
