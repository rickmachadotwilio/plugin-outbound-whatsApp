const TokenValidator = require("twilio-flex-token-validator").functionValidator;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Twilio Conversations sets a message's author to the customer's address for
// inbound WhatsApp messages (e.g. "whatsapp:+55...").
const findLatestInboundInConversation = async (
  client,
  conversationSid,
  customerAddress
) => {
  const messages = await client.conversations.v1
    .conversations(conversationSid)
    .messages.list({ order: "desc", limit: 50 });

  return messages.find((m) => m.author === customerAddress) || null;
};

exports.handler = TokenValidator(async function (context, event, callback) {
  const response = new Twilio.Response();

  response.appendHeader("Access-Control-Allow-Origin", "*");
  response.appendHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, DELETE"
  );
  response.appendHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept, X-Requested-With"
  );
  response.appendHeader("Access-Control-Max-Age", "3600");
  response.appendHeader("Content-Type", "application/json");

  if ((event.method || event.httpMethod || "").toUpperCase() === "OPTIONS") {
    response.setStatusCode(200);
    return callback(null, response);
  }

  const { To, From } = event;

  if (!To || !From) {
    response.setStatusCode(400);
    response.setBody({ error: true, message: "To and From are required" });
    return callback(null, response);
  }

  try {
    const client = context.getTwilioClient();

    const participantConversations =
      await client.conversations.v1.participantConversations.list({
        address: To,
        limit: 100,
      });

    console.log(
      `[checkWhatsAppSession] To=${To} From=${From} — found ${participantConversations.length} participant conversation(s)`
    );
    participantConversations.forEach((pc) => {
      console.log(
        `  conversationSid=${pc.conversationSid} state=${pc.conversationState} binding=${JSON.stringify(
          pc.participantMessagingBinding
        )}`
      );
    });

    // We look at every conversation the customer participates in (any state)
    // and take the newest customer-authored message across them. The Twilio
    // conversation lifecycle (active/inactive/closed) is unrelated to
    // WhatsApp's 24-hour session — that rule is purely "did the customer
    // message us in the last 24h?".
    if (participantConversations.length === 0) {
      response.setStatusCode(200);
      response.setBody({
        withinWindow: false,
        hasActiveConversation: false,
        lastInboundAt: null,
      });
      return callback(null, response);
    }

    const inboundResults = await Promise.all(
      participantConversations.map((pc) =>
        findLatestInboundInConversation(client, pc.conversationSid, To).catch(
          (err) => {
            console.warn(
              `  messages.list failed for ${pc.conversationSid}: ${err.message}`
            );
            return null;
          }
        )
      )
    );

    let latestInbound = null;
    for (const msg of inboundResults) {
      if (!msg) continue;
      if (
        !latestInbound ||
        new Date(msg.dateCreated) > new Date(latestInbound.dateCreated)
      ) {
        latestInbound = msg;
      }
    }

    const hasActiveConversation = participantConversations.some(
      (pc) => pc.conversationState === "active"
    );

    if (!latestInbound) {
      console.log(
        "[checkWhatsAppSession] no customer-authored message found in any matching conversation"
      );
      response.setStatusCode(200);
      response.setBody({
        withinWindow: false,
        hasActiveConversation,
        lastInboundAt: null,
      });
      return callback(null, response);
    }

    const lastInboundAt = new Date(latestInbound.dateCreated).getTime();
    const withinWindow = Date.now() - lastInboundAt < TWENTY_FOUR_HOURS_MS;

    console.log(
      `[checkWhatsAppSession] lastInboundAt=${new Date(
        lastInboundAt
      ).toISOString()} withinWindow=${withinWindow} hasActiveConversation=${hasActiveConversation}`
    );

    response.setStatusCode(200);
    response.setBody({
      withinWindow,
      hasActiveConversation,
      lastInboundAt: new Date(lastInboundAt).toISOString(),
    });
    return callback(null, response);
  } catch (error) {
    console.error("Error checking WhatsApp session:", error);
    response.setStatusCode(500);
    response.setBody({ error: true, message: error.message });
    return callback(null, response);
  }
});
