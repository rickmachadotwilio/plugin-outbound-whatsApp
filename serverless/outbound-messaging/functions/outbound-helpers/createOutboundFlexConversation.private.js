const {
  addAgentMessageToConversation,
} = require(Runtime.getFunctions()["api-helpers/conversations_helper"].path);

const parseAttributes = (raw) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`Could not parse conversation attributes: ${e.message}`);
    return {};
  }
};

// Wrap this customer conversation in a Flex Interaction and route it to an
// agent. Two paths:
//   1. Fresh conversation with no prior interaction attributes -> create a
//      new Interaction (client.flexApi.v1.interaction.create).
//   2. Reused conversation that already has interactionSid + channelSid
//      attributes (a previous chat that has since been wrapped) -> Twilio
//      rejects a second interaction on the same channel with 409, so we
//      invite the agent onto the existing channel instead. This creates a
//      new task without disturbing the existing channel.
exports.createOutboundFlexConversation = async (
  client,
  customerConversation,
  To,
  From,
  Body,
  ContentTemplateSid,
  ContentVariables,
  WorkerFriendlyName,
  routingProperties
) => {
  const channelType = To.startsWith("whatsapp") ? "whatsapp" : "sms";
  const existingAttrs = parseAttributes(customerConversation.attributes);
  const conversationSid = customerConversation.sid;

  const routing = {
    properties: {
      ...routingProperties,
      task_channel_unique_name: "chat",
      attributes: {
        from: To,
        direction: "outbound",
        customerName: "Customer",
        customerAddress: To,
        twilioNumber: From,
        channelType: channelType,
        conversationSid,
      },
    },
  };

  const hasExistingChannel =
    existingAttrs.channelSid && existingAttrs.interactionSid;

  let taskSid;
  let interactionSid;
  let channelSid;

  if (hasExistingChannel) {
    console.log(
      `Reusing existing Flex interaction ${existingAttrs.interactionSid} / channel ${existingAttrs.channelSid} on ${conversationSid} — inviting agent instead of creating a new interaction`
    );
    try {
      const invite = await client.flexApi.v1
        .interaction(existingAttrs.interactionSid)
        .channels(existingAttrs.channelSid)
        .invites.create({ routing });

      interactionSid = existingAttrs.interactionSid;
      channelSid = existingAttrs.channelSid;
      taskSid =
        invite.routing &&
        invite.routing.properties &&
        invite.routing.properties.sid;
    } catch (err) {
      // If the existing channel is closed / no longer accepts invites we
      // can't recover automatically — surface a clear error to the agent.
      console.error(
        `Invite to existing channel ${existingAttrs.channelSid} failed: ${err.message} (status ${err.status || "?"})`
      );
      return {
        success: false,
        errorMessage: `Couldn't open a new chat — an earlier chat with ${To} is still attached to this conversation. Ask an admin to clean up conversation ${conversationSid}, or wait for the customer to reply.`,
      };
    }
  } else {
    const interaction = await client.flexApi.v1.interaction.create({
      channel: {
        type: channelType,
        initiated_by: "agent",
        properties: { media_channel_sid: conversationSid },
      },
      routing,
    });

    const interactionAttrs =
      interaction.routing && interaction.routing.properties
        ? JSON.parse(interaction.routing.properties.attributes)
        : {};
    interactionSid = interaction.sid;
    channelSid = interactionAttrs.channelSid;
    taskSid = interactionAttrs.taskSid;
  }

  // Add the outbound message to the conversation. Uses the shared helper so
  // ContentSid / ContentVariables threading stays consistent with the
  // wait-for-reply path.
  await addAgentMessageToConversation(
    client,
    { sid: conversationSid },
    WorkerFriendlyName,
    Body,
    channelType === "whatsapp" ? ContentTemplateSid : undefined,
    channelType === "whatsapp" ? ContentVariables : undefined
  );

  return {
    success: true,
    interactionSid,
    channelSid,
    taskSid,
    conversationSid,
  };
};
