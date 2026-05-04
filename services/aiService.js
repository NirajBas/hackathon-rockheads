const OpenAI = require("openai");
const logger = require("../utils/logger");

const client = process.env.GROK_API_KEY
  ? new OpenAI({ 
      apiKey: process.env.GROK_API_KEY,
      baseURL: "https://api.x.ai/v1"
    })
  : null;

const normalizeSeverity = (value) =>
  ["low", "medium", "high"].includes(value) ? value : "medium";

const normalizeEmergencyType = (value) =>
  ["cardiac", "trauma", "accident"].includes(value) ? value : "accident";

const normalizeRecommendedSpecialty = (value, emergencyType) => {
  if (["trauma", "cardiac", "general"].includes(value)) return value;
  if (emergencyType === "cardiac") return "cardiac";
  if (emergencyType === "trauma") return "trauma";
  return "general";
};

const normalizeRequiredBeds = (value) =>
  ["ICU", "ER", "general"].includes(value) ? value : "ER";

const normalizeUrgencyScore = (value, severity) => {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1 && n <= 10) return Math.round(n);
  if (severity === "high") return 9;
  if (severity === "medium") return 6;
  return 3;
};

/** Deterministic fallback when OpenAI is unavailable — mirrors full response shape */
const mockClassify = (trigger = "") => {
  const normalized = trigger.toLowerCase();

  if (normalized.includes("accident") || normalized.includes("unconscious")) {
    return {
      severity: "high",
      emergencyType: "trauma",
      recommendedSpecialty: "trauma",
      requiredBeds: "ICU",
      urgencyScore: 9
    };
  }
  if (normalized.includes("chest") || normalized.includes("cardiac")) {
    return {
      severity: "high",
      emergencyType: "cardiac",
      recommendedSpecialty: "cardiac",
      requiredBeds: "ICU",
      urgencyScore: 9
    };
  }
  if (normalized.includes("bleeding") || normalized.includes("fracture")) {
    return {
      severity: "medium",
      emergencyType: "trauma",
      recommendedSpecialty: "trauma",
      requiredBeds: "ER",
      urgencyScore: 6
    };
  }

  return {
    severity: "low",
    emergencyType: "accident",
    recommendedSpecialty: "general",
    requiredBeds: "ER",
    urgencyScore: 3
  };
};

const parseAiPayload = (raw, trigger) => {
  const fallback = mockClassify(trigger);
  if (!raw || typeof raw !== "object") return fallback;

  const severity = normalizeSeverity(raw.severity);
  const emergencyType = normalizeEmergencyType(raw.emergencyType);
  return {
    severity,
    emergencyType,
    recommendedSpecialty: normalizeRecommendedSpecialty(raw.recommendedSpecialty, emergencyType),
    requiredBeds: normalizeRequiredBeds(raw.requiredBeds),
    urgencyScore: normalizeUrgencyScore(raw.urgencyScore, severity)
  };
};

// Classifies an emergency trigger into severity, type, specialty, beds, and urgency (1–10).
const classifyEmergency = async (trigger) => {
  if (!client) {
    logger.warn("OPENAI_API_KEY missing. Using fallback emergency classifier.");
    return mockClassify(trigger);
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `Classify the emergency. Return ONLY valid JSON with keys:
severity: "low"|"medium"|"high"
emergencyType: "cardiac"|"trauma"|"accident"
recommendedSpecialty: "trauma"|"cardiac"|"general"
requiredBeds: "ICU"|"ER"|"general"
urgencyScore: integer 1-10`
        },
        {
          role: "user",
          content: `Trigger: "${trigger}"`
        }
      ],
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    return parseAiPayload(parsed, trigger);
  } catch (error) {
    logger.error("OpenAI classification failed, using fallback:", error.message);
    return mockClassify(trigger);
  }
};

module.exports = {
  classifyEmergency
};
