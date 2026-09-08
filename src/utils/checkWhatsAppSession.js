import { Manager } from "@twilio/flex-ui";

const manager = Manager.getInstance();

export const checkWhatsAppSession = async (to, from) => {
  const body = {
    To: to,
    From: from,
    Token: manager.store.getState().flex.session.ssoTokenPayload.token,
  };

  const options = {
    method: "POST",
    body: new URLSearchParams(body),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
  };

  try {
    const response = await fetch(
      `${process.env.FLEX_APP_TWILIO_SERVERLESS_DOMAIN}/checkWhatsAppSession`,
      options
    );
    return await response.json();
  } catch (error) {
    console.error("Error checking WhatsApp session:", error);
    return {
      withinWindow: false,
      hasActiveConversation: false,
      lastInboundAt: null,
      error: true,
    };
  }
};
