/* Shared, non-secret simulation contract and conservative evidence filtering. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SimulationCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const warning = "This is a hypothetical AI-generated situation, not a report of a real event.";
  const sensitive = /\b(trauma|abuse|suicid\w*|self.harm|rape|assault|diagnos\w*|depress\w*|anxiety|autis\w*|adhd|disab\w*|health|medical|cancer|religio\w*|christian|muslim|islam|buddhis\w*|jewish|hindu|atheis\w*|sexual\w*|gay|lesbian|bisexual|transgender|ethnic\w*|race|racial|politic\w*|democrat|republican|conservative|liberal|pregnan\w*|medication|therapy|ptsd|bipolar|addict\w*|crime|criminal|violence|emergency|investment|mortgage)\b/i;
  const pool = [
    { id: "shared-space", title: "One room, two plans", scenario: "You arrive to use a shared studio you booked, but another group believes it has the same slot. Neither group has started yet.", terms: /studio|double.book|shared.space|booking|same.slot/i, action: "compare the booking confirmations with the group and propose splitting the time", dialogue: "Can we check both bookings and find a fair way to use the room?" },
    { id: "honest-feedback", title: "An honest first impression", scenario: "An acquaintance shows you a handmade poster for a hobby event. They are proud of it, but the date is difficult to read. They ask for your honest first impression.", terms: /poster|honest.feedback|hobby.event|design.feedback/i, action: "point to the unclear date and suggest a small change before commenting on the rest", dialogue: "I like the effort behind this. Could we make the date easier to read?" },
    { id: "asking-help", title: "More than two hands", scenario: "While setting up a neighbourhood book swap, you discover that sorting the donations will take longer than expected. Other volunteers are nearby, but nobody knows you need help.", terms: /book.swap|donations|volunteer|ask\w* for help/i, action: "ask two volunteers to take a clearly defined part of the sorting", dialogue: "Could you sort these two boxes while I set up the remaining table?" },
    { id: "failed-plans", title: "The closed workshop", scenario: "You arrive at a small creative workshop and find it has been cancelled. Several attendees are waiting, and someone suggests organising an informal activity together instead.", terms: /workshop|cancelled|canceled|plans.fail/i, action: "ask what everyone brought and propose a short activity using those materials", dialogue: "Would anyone like to try a small version of the activity together?" },
    { id: "shared-credit", title: "The missing name", scenario: "A group publishes a thank-you note for a community display. One contributor who helped substantially has been left out, and you notice before anyone else comments.", terms: /credit|contributor|thank.you|left.out|missing.name/i, action: "privately ask the organiser to add the missing contributor before sharing the note", dialogue: "Could we add their name? They helped with a substantial part of the display." },
    { id: "everyday-boundary", title: "Before borrowing again", scenario: "A neighbour returns your tool after borrowing it without asking a second time. They assume you do not mind and mention that they will need it again next weekend.", terms: /borrow|tool|neighbour|neighbor|boundar/i, action: "explain that they must ask first and agree on a return time for any future loan", dialogue: "Please check with me first next time, even if I have lent it before." }
  ];
  const str = { type: "string" };
  const list = { type: "array", items: str };
  const object = properties => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
  const schema = object({
    scenario_id: { type: "string", enum: pool.map(s => s.id) }, scenario_title: str, scenario: str,
    predicted_decision: str, predicted_action: str, predicted_thought: str,
    predicted_dialogue: { type: ["string", "null"] }, predicted_consequence: str,
    evidence: { type: "array", items: object({ source_id: str, source: str, interpretation: str, type: { type: "string", enum: ["supplied", "inferred"] } }) },
    generated_elements: list,
    contradictory_evidence: { type: "array", items: object({ evidence_ids: list, description: str, participant_explanation: str }) },
    confidence: { type: "string", enum: ["low", "medium", "high"] }, uncertainty_statement: str,
    alternative_action: str, unknowns: list,
    source_label: { type: "string", enum: ["GENERATED"] }, warning: { type: "string", enum: [warning] }
  });
  function evidenceContext(input = {}) {
    const answers = Array.isArray(input.answers) ? input.answers : [];
    const context = input.context || {};
    const sources = [];
    const safeIds = new Set();
    answers.forEach(a => {
      if (typeof a.id !== "string" || typeof a.answer !== "string" || !a.answer.trim() || a.id === "image_context" || sensitive.test(`${a.question} ${a.answer}`) || safeIds.has(a.id)) return;
      safeIds.add(a.id);
      sources.push({ id: a.id, type: "supplied", label: a.question || a.id, text: a.answer.trim(), evidence_ids: [a.id] });
    });
    const feedback = new Map((context.profile_feedback || []).map(f => [f.id, f]));
    for (const item of context.profile?.inferred_information || []) {
      const review = feedback.get(item.id);
      if (["rejected", "corrected"].includes(review?.verdict)) {
        if (review.verdict === "corrected" && review.correction?.trim() && !sensitive.test(review.correction)) {
          const id = `correction:${item.id}`;
          sources.push({ id, type: "supplied", label: "Your correction to the identity profile", text: review.correction.trim(), evidence_ids: [id] });
        }
        continue;
      }
      if (!item.evidence_ids?.length || !item.evidence_ids.every(id => safeIds.has(id)) || sensitive.test(item.statement || "")) continue;
      sources.push({ id: item.id, type: "inferred", label: "Temporary identity-profile interpretation", text: item.statement, evidence_ids: [...item.evidence_ids] });
    }
    const contradictions = [];
    (context.profile?.contradictions || []).forEach((c, index) => {
      const review = context.contradiction_feedback?.find(f => f.id === `contradiction_${index + 1}`);
      if (review?.verdict === "not-a-contradiction") {
        if (review.explanation?.trim() && !sensitive.test(review.explanation)) sources.push({ id: `clarification:${index}`, type: "supplied", label: "Your explanation of a possible contradiction", text: review.explanation, evidence_ids: [] });
        return;
      }
      if (!c.evidence_ids?.length || !c.evidence_ids.every(id => safeIds.has(id)) || sensitive.test(`${c.description} ${review?.explanation || ""}`)) return;
      contradictions.push({ evidence_ids: [...c.evidence_ids], description: c.description, participant_explanation: review?.explanation || "" });
    });
    return { sources, contradictions };
  }
  function candidates(input) {
    const previous = (input.answers || []).map(a => `${a.question} ${a.answer}`).join(" ") + " " + (input.discussed_questions || []).join(" ");
    return pool.filter(s => !s.terms.test(previous) && !(input.seen_scenarios || []).includes(s.id));
  }
  function validate(result, context, allowed) {
    const errors = [];
    function shape(value, spec, path) {
      if (Array.isArray(spec.type)) { if (value === null && spec.type.includes("null")) return; spec = { ...spec, type: "string" }; }
      if (spec.type === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value)) return errors.push(`${path}: object required`);
        for (const key of spec.required) if (!(key in value)) errors.push(`${path}.${key}: required`);
        for (const key of Object.keys(value)) if (!Object.hasOwn(spec.properties, key)) errors.push(`${path}.${key}: unexpected`); else shape(value[key], spec.properties[key], `${path}.${key}`);
      } else if (spec.type === "array") {
        if (!Array.isArray(value)) return errors.push(`${path}: array required`);
        value.forEach((v, i) => shape(v, spec.items, `${path}[${i}]`));
      } else if (typeof value !== spec.type) errors.push(`${path}: ${spec.type} required`);
      if (spec.enum && !spec.enum.includes(value)) errors.push(`${path}: invalid value`);
    }
    shape(result, schema, "simulation");
    if (errors.length) return errors;
    const selected = allowed.find(s => s.id === result.scenario_id);
    if (!selected || result.scenario !== selected.scenario || result.scenario_title !== selected.title) errors.push("scenario: not an eligible new situation");
    const sourceMap = new Map(context.sources.map(s => [s.id, s]));
    result.evidence.forEach(e => {
      const s = sourceMap.get(e.source_id);
      if (!s) errors.push("evidence: invalid provenance (unknown source_id)");
      else if (s.type !== e.type) errors.push("evidence: invalid provenance (source type mismatch)");
      else if (e.source !== s.label) errors.push("evidence: invalid provenance (display label mismatch)");
    });
    if (JSON.stringify(result.contradictory_evidence) !== JSON.stringify(context.contradictions)) errors.push("contradictions: must be preserved exactly");
    if ((context.sources.filter(s => s.type === "supplied").length < 2 || context.contradictions.length) && result.confidence !== "low") errors.push("confidence: low required for limited or contradictory evidence");
    for (const key of ["predicted_decision", "predicted_action", "predicted_thought", "predicted_consequence", "uncertainty_statement", "alternative_action"]) {
      if (!result[key].trim() || result[key].length > 650) errors.push(`${key}: empty or too long`);
    }
    if (!/may|might|possible|plausible|could|uncertain/i.test(result.uncertainty_statement)) errors.push("uncertainty: required");
    if (result.generated_elements.length < 3) errors.push("generated elements: behavior must be labelled");
    const behavior = [result.predicted_decision, result.predicted_action, result.predicted_thought, result.predicted_dialogue || "", result.predicted_consequence].join(" ");
    if (/\bI remember\b|recovered memory|forgotten memory/i.test(behavior) || sensitive.test(behavior)) errors.push("behavior: sensitive content or memory framing");
    if (sensitive.test([...result.evidence.map(e => e.interpretation), ...result.unknowns, result.uncertainty_statement, result.alternative_action, ...result.generated_elements].join(" "))) errors.push("explanation: sensitive expansion");
    if (context.sources.length && !result.evidence.length) errors.push("evidence: cite eligible influences");
    if (!context.sources.length && (!result.unknowns.length || result.evidence.length)) errors.push("unknowns: no participant evidence available");
    return errors;
  }
  function mock(input) {
    const context = evidenceContext(input), choices = candidates(input);
    const s = choices[0];
    if (!s) throw new Error("No unused situation is available. Review your information or finish without a simulation.");
    const text = context.sources.map(s => s.text).join(" ");
    const pause = /wait|quiet|withdraw|time to think|reflect/i.test(text);
    const result = {
      scenario_id: s.id, scenario_title: s.title, scenario: s.scenario,
      predicted_decision: pause ? "One possible version of you might pause to understand the problem before committing to a response." : "One possible version of you might choose a small, direct step instead of leaving the problem unresolved.",
      predicted_action: `You might ${pause ? "first ask for a moment to think, then " : ""}${s.action}.`,
      predicted_thought: "You might weigh the discomfort of speaking up against the uncertainty of doing nothing. Your actual reaction is unknown.",
      predicted_dialogue: s.dialogue,
      predicted_consequence: "The other person could respond constructively or disagree; the outcome is unknown.",
      evidence: context.sources.slice(0, 3).map(s => ({ source_id: s.id, source: s.label, type: s.type, interpretation: "This eligible source was available to the rule-based demonstration; it does not establish how you would act." })),
      generated_elements: ["The situation", "The possible decision and action", "The imagined internal reaction", "The dialogue and possible consequence"],
      contradictory_evidence: context.contradictions,
      confidence: "low", uncertainty_statement: "This is a rule-based demonstration, not a live AI prediction. You might respond very differently.",
      alternative_action: pause ? "You might instead respond immediately and adjust after hearing the other person's view." : "You might instead wait, gather more context and ask someone else for a perspective.",
      unknowns: ["Your actual response in this situation", "The other person's response"], source_label: "GENERATED", warning
    };
    return result;
  }
  return { warning, sensitive, pool, schema, evidenceContext, candidates, validate, mock };
});
