const twilio = require("twilio");
const logger = require("../utils/logger");

const client = process.env.TWILIO_ACCOUNT_SID
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

async function sendEmergencySMS(toNumber, payload) {
  if (!client) {
    logger.warn("[SMS]", "Twilio not configured — skipping SMS");
    return;
  }

  const message = `
🚨 EMERGENCY ALERT
Type: ${payload.emergencyType}
Severity: ${payload.severity.toUpperCase()}
Urgency: ${payload.urgencyScore}/10
Ambulance: ${payload.ambulanceType} (${payload.ambulanceId})
Hospital: ${payload.hospitalName}
ETA: ${payload.eta}
Emergency ID: ${payload.emergencyId}
  `.trim();

  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: toNumber
    });
    logger.log("[SMS]", `SMS sent to ${toNumber}`);
  } catch (err) {
    logger.error("[SMS]", "Failed to send SMS:", err.message);
  }
}

module.exports = { sendEmergencySMS };