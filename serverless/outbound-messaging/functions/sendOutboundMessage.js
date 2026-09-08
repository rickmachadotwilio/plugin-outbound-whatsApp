const TokenValidator = require("twilio-flex-token-validator").functionValidator;
const { createOutboundCustomerConversation } = require(Runtime.getFunctions()[
  "api-helpers/conversations_helper"
].path);

const { sendOutboundMessageAndWaitForReply } = require(Runtime.getFunctions()[
  "outbound-helpers/sendOutboundMessageAndWaitForReply"
].path);

const { createOutboundFlexConversation } = require(Runtime.getFunctions()[
  "outbound-helpers/createOutboundFlexConversation"
].path);

const directionText = (taskDirection) => {
  if (!taskDirection) return "";
  switch (taskDirection.toLowerCase()) {
    case "inbound":
      return "Inbound";
    case "outbound":
      return "Outbound";
    default:
      return "";
  }
};

const existingOpenConversationResponse = (
  callback,
  response,
  existingConversationDetails,
  to
) => {
  const direction = directionText(existingConversationDetails.taskDirection);
  const agentName = existingConversationDetails.agentName
    ? ` with ${existingConversationDetails.agentName}`
    : "";

  response.appendHeader("Content-Type", "application/json");
  response.setBody({
    success: false,
    errorMessage: `Error sending message. There is an open ${direction} conversation already to ${to} ${agentName}`,
  });
  return callback(null, response);
};

exports.handler = TokenValidator(async function (context, event, callback) {
  const {
    To,
    From,
    ContentTemplateSid,
    ContentVariables,
    Body,
    WorkspaceSid,
    WorkflowSid,
    QueueSid,
    WorkerSid,
    WorkerFriendlyName,
    InboundStudioFlow,
  } = event;

  let { OpenChatFlag, KnownAgentRoutingFlag } = event;
  OpenChatFlag = OpenChatFlag === "true" ? true : false;
  KnownAgentRoutingFlag = KnownAgentRoutingFlag === "true" ? true : false;

  const client = context.getTwilioClient();

  // Create a custom Twilio Response
  // Set the CORS headers to allow Flex to make an HTTP request to the Twilio Function
  const response = new Twilio.Response();
  response.appendHeader("Access-Control-Allow-Origin", "*");
  response.appendHeader("Access-Control-Allow-Methods", "OPTIONS POST GET");
  response.appendHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    let customerConversation = undefined;
    let reusingExistingConversation = false;

    // either create a new conversation or if there is already an active conversation in progress
    // then get its details and depending on outbound scenario we may be able to re-use it
    const { newConversation, existingConversationDetails } =
      await createOutboundCustomerConversation(client, WorkspaceSid, To, From);

    // Handle existing conversation in progress.
    //
    // Rules by mode:
    //   OPEN_CHAT (task creation now):
    //     - If an active task already exists on the conversation, refuse —
    //       you can't open a second parallel chat with the same customer.
    //     - Otherwise reuse the conversation; the invite path in
    //       createOutboundFlexConversation will create a fresh task on the
    //       existing channel.
    //   WAIT_FOR_REPLY (no task now, Studio creates one on reply):
    //     - Always reuse the conversation. We're only adding a message; the
    //       existing task (if any) can keep handling replies, no new task
    //       needs to be created here.
    if (existingConversationDetails) {
      if (OpenChatFlag && existingConversationDetails.taskExists) {
        return existingOpenConversationResponse(
          callback,
          response,
          existingConversationDetails,
          To
        );
      }

      console.log(
        `Reusing active conversation ${existingConversationDetails.conversation.sid} (taskExists=${existingConversationDetails.taskExists}, mode=${
          OpenChatFlag ? "openChat" : "waitForReply"
        })`
      );

      customerConversation = existingConversationDetails.conversation;
      reusingExistingConversation = true;
    } else {
      customerConversation = newConversation;
    }

    // We have a conversation resource to use. Check if we are a send and wait for reply sceanrio
    // or if we need to use Interactins API to creaet a task.

    let responseBody = {};

    if (!OpenChatFlag) {
      responseBody = await sendOutboundMessageAndWaitForReply(
        client,
        customerConversation,
        Body,
        ContentTemplateSid,
        ContentVariables,
        KnownAgentRoutingFlag,
        WorkerFriendlyName,
        WorkerSid,
        InboundStudioFlow,
        reusingExistingConversation
      );
    } else {
      responseBody = await createOutboundFlexConversation(
        client,
        customerConversation,
        To,
        From,
        Body,
        ContentTemplateSid,
        ContentVariables,
        WorkerFriendlyName,
        {
          workspace_sid: WorkspaceSid,
          workflow_sid: WorkflowSid,
          queue_sid: QueueSid,
          worker_sid: WorkerSid,
        }
      );
    }

    response.appendHeader("Content-Type", "application/json");
    response.setBody(responseBody);
    // Return a success response using the callback function.
    callback(null, response);
  } catch (err) {
    // Always respond in JSON — the client parses .json() and would otherwise
    // hit a SyntaxError, masking the real cause with a generic "Error calling
    // sendOutboundMessage function" toast.
    console.error(err);
    response.appendHeader("Content-Type", "application/json");
    response.setStatusCode(500);
    response.setBody({
      success: false,
      errorMessage: err.message || "Unexpected error sending message",
    });
    callback(null, response);
  }
});
