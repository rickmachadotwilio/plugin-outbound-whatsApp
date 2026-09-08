import { Actions } from "@twilio/flex-ui";
export const handleClose = () => {
  Actions.invokeAction("ToggleOutboundMessagePanel");
};

export const onSendClickHandler = (
  menuItemClicked,
  toNumber,
  fromNumber,
  messageType,
  messageBody,
  contentTemplateSid,
  contentVariables
) => {
  const hasVariables =
    contentVariables && Object.keys(contentVariables).length > 0;

  let payload = {
    destination: messageType === "whatsapp" ? "whatsapp:" + toNumber : toNumber,
    callerId:
      messageType === "whatsapp"
        ? "whatsapp:" + fromNumber
        : fromNumber,
    body: messageBody,
    contentTemplateSid,
    contentVariables: hasVariables ? JSON.stringify(contentVariables) : undefined,
    messageType,
    openChat: true,
    routeToMe: true,
  };

  // defer opening a task until customer replies
  switch (menuItemClicked) {
    case "SEND_MESSAGE_REPLY_ME":
      payload.openChat = false;
      payload.routeToMe = true;
      break;
    case "SEND_MESSAGE":
      payload.openChat = false;
      payload.routeToMe = false;
      break;
    default:
      break;
  }

  Actions.invokeAction("SendOutboundMessage", payload);
  Actions.invokeAction("ToggleOutboundMessagePanel");
};
