const {
  taskDetailsFromConversationSid,
  agentNameFromIdentity,
} = require(Runtime.getFunctions()["api-helpers/taskrouter_helper"].path);

const parseConversationSid = (str) => {
  const regex = /\bCH[a-zA-Z0-9]{32}\b/;
  const matches = str.match(regex);

  return matches.length ? matches[0] : undefined;
};

const agentIdentityFromConversation = async (client, conversationSid) => {
  const participants = await client.conversations.v1
    .conversations(conversationSid)
    .participants.list();

  // return the first participant that is an sdk identity rather than messagingBinding.
  // This participant should be the agent
  for (const participant of participants) {
    if (participant.identity) {
      return decodeURIComponent(participant.identity.replace("_", "%")); // flex encodes non alpha with _ rather than %
    }
  }
};

exports.createOutboundCustomerConversation = async (
  client,
  workspaceSid,
  to,
  from
) => {
  const conversation = await client.conversations.v1.conversations.create();
  console.log("Created conversation", conversation.sid);

  // 'to' is the customer number
  // 'from' is the Twilio number
  try {
    const participant = await client.conversations.v1
      .conversations(conversation.sid)
      .participants.create({
        "messagingBinding.address": to,
        "messagingBinding.proxyAddress": from,
      });

    return { newConversation: conversation };
  } catch (error) {
    if (error.code === 50416) {
      // There is already an active conversation with the customer from the twilio number
      // Lets figure out direction and participants so we can return useful warning
      const existingConversationSid = parseConversationSid(error.message);

      // delete the conversation that we created but couldn't use as participant add failed
      await client.conversations.v1.conversations(conversation.sid).remove();
      console.log("Deleted conversation", conversation.sid);

      if (!existingConversationSid) return {};

      const existingConversation = await client.conversations.v1
        .conversations(existingConversationSid)
        .fetch();

      console.log(
        "Active conversation for this messagingBinding participant",
        existingConversation
      );

      const agentIdentity = await agentIdentityFromConversation(
        client,
        existingConversationSid
      );

      const agentName = await agentNameFromIdentity(
        client,
        workspaceSid,
        agentIdentity
      );

      const { taskExists, taskDirection } =
        (await taskDetailsFromConversationSid(
          client,
          workspaceSid,
          existingConversationSid
        )) || {};

      return {
        existingConversationDetails: {
          conversation: existingConversation,
          taskDirection,
          taskExists,
          agentName,
        },
      };
    } else {
      throw error;
    }
  }
};

exports.setKnownAgentRoutingOnConversationAttributes = async (
  client,
  conversation,
  WorkerSid
) => {
  // Preserve any attributes already on the conversation (e.g. interactionSid,
  // channelSid, taskSid that the Flex Interactions API may have written) —
  // overwriting them can break routing on subsequent replies.
  let existingAttributes = {};
  try {
    const raw = conversation.attributes || "";
    if (raw) existingAttributes = JSON.parse(raw);
  } catch (e) {
    console.warn(
      `Could not parse existing conversation attributes for ${conversation.sid}: ${e.message}`
    );
  }

  const conversationAttributes = {
    ...existingAttributes,
    KnownAgentRoutingFlag: true,
    KnownAgentWorkerSid: WorkerSid,
  };

  console.log(
    `Setting known-agent routing on ${conversation.sid}: worker=${WorkerSid}`
  );

  await client.conversations.v1
    .conversations(conversation.sid)
    .update({ attributes: JSON.stringify(conversationAttributes) });
};

exports.setStudioWebhookOnConversation = async (
  client,
  conversation,
  InboundStudioFlow
) => {
  console.log(
    `Setting Studio webhook on ${conversation.sid} -> flow ${InboundStudioFlow}`
  );
  await client.conversations.v1
    .conversations(conversation.sid)
    .webhooks.create({
      target: "studio",
      "configuration.flowSid": `${InboundStudioFlow}`,
    });
};

// Ensure the conversation has a Studio webhook pointing at InboundStudioFlow.
// A reused conversation created earlier via the Interactions API (OPEN_CHAT
// mode) has no Studio webhook, so a customer reply never triggers a flow —
// this is what silently drops replies when reusing.
exports.ensureStudioWebhookOnConversation = async (
  client,
  conversation,
  InboundStudioFlow
) => {
  const webhooks = await client.conversations.v1
    .conversations(conversation.sid)
    .webhooks.list();

  const already = webhooks.find(
    (w) =>
      w.target === "studio" &&
      w.configuration &&
      w.configuration.flow_sid === InboundStudioFlow
  );

  if (already) {
    console.log(
      `Studio webhook already present on ${conversation.sid} (${already.sid})`
    );
    return already;
  }

  return exports.setStudioWebhookOnConversation(
    client,
    conversation,
    InboundStudioFlow
  );
};

exports.addAgentMessageToConversation = async (
  client,
  conversation,
  WorkerFriendlyName,
  Body,
  ContentTemplateSid,
  ContentVariables
) => {
  const messageOptions = {
    author: WorkerFriendlyName,
  };

  if (ContentTemplateSid) {
    messageOptions.contentSid = ContentTemplateSid;
    if (ContentVariables) {
      messageOptions.contentVariables = ContentVariables;
    }
  } else {
    messageOptions.body = Body;
  }

  const message = await client.conversations.v1
    .conversations(conversation.sid)
    .messages.create(messageOptions);
};
