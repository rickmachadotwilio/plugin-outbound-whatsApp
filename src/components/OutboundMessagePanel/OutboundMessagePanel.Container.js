import React, { useState, useEffect, useMemo, useRef } from "react";
import { Dialer, Manager, useFlexSelector } from "@twilio/flex-ui";
import { Label } from "@twilio-paste/core/label";
import { TextArea } from "@twilio-paste/core/textarea";
import { Input } from "@twilio-paste/core/input";
import { Radio, RadioGroup } from "@twilio-paste/core/radio-group";
import { Text } from "@twilio-paste/core/text";
import { Select, Option } from "@twilio-paste/core/select";
import { Separator } from "@twilio-paste/core/separator";
import { Box } from "@twilio-paste/core/box";
import { CheckmarkCircleIcon } from "@twilio-paste/icons/esm/CheckmarkCircleIcon";
import { WarningIcon } from "@twilio-paste/icons/esm/WarningIcon";
import { InformationIcon } from "@twilio-paste/icons/esm/InformationIcon";
import { LoadingIcon } from "@twilio-paste/icons/esm/LoadingIcon";
import {
  Container,
  StyledSidePanel,
  DialerContainer,
  MessageContainer,
  SendMessageContainer,
  MessageTypeContainer,
  OfflineContainer,
  ErrorIcon,
} from "./OutboundMessagePanel.Components";
import SendMessageMenu from "./SendMessageMenu";
import { onSendClickHandler, handleClose } from "./clickHandlers";
import { templates } from "../../utils/templates";
import { PhoneNumberUtil, AsYouTypeFormatter } from "google-libphonenumber";
import { fetchContentTemplates } from "../../utils/fetchContentTemplates";
import { checkWhatsAppSession } from "../../utils/checkWhatsAppSession";
import {
  extractPlaceholders,
  renderPreview,
  timeAgo,
} from "../../utils/contentVariables";

const DEFAULT_TO_NUMBER = "+55";
const DEFAULT_COUNTRY = "BR";
const DEFAULT_MESSAGE_TYPE = "whatsapp";

const isWorkerAvailable = (worker) => {
  const { taskrouter_offline_activity_sid } =
    Manager.getInstance().serviceConfiguration;

  return worker.activity?.sid !== taskrouter_offline_activity_sid;
};

const isToNumberValid = (toNumber) => {
  const phoneUtil = PhoneNumberUtil.getInstance();
  try {
    const parsedToNumber = phoneUtil.parse(toNumber);
    if (phoneUtil.isPossibleNumber(parsedToNumber))
      if (phoneUtil.isValidNumber(parsedToNumber)) return true;

    return false;
  } catch (error) {
    return false;
  }
};

// Compact single-row status chip — replaces Paste's Callout so the narrow
// side panel keeps its vertical budget free for the composer.
const StatusChip = ({ tone, icon: Icon, title, subtitle }) => {
  const palette = {
    success: {
      bg: "colorBackgroundSuccessWeakest",
      border: "colorBorderSuccessWeaker",
      title: "colorTextSuccess",
      iconColor: "colorTextIconSuccess",
    },
    warning: {
      bg: "colorBackgroundWarningWeakest",
      border: "colorBorderWarningWeaker",
      title: "colorTextWarningStrong",
      iconColor: "colorTextIconWarning",
    },
    neutral: {
      bg: "colorBackgroundWeak",
      border: "colorBorderWeaker",
      title: "colorText",
      iconColor: "colorTextIcon",
    },
  }[tone] || {};

  return (
    <Box
      display="flex"
      alignItems="center"
      columnGap="space30"
      paddingY="space20"
      paddingX="space30"
      backgroundColor={palette.bg}
      borderColor={palette.border}
      borderStyle="solid"
      borderWidth="borderWidth10"
      borderRadius="borderRadius20"
    >
      <Box flexShrink={0} display="flex" alignItems="center">
        <Icon decorative color={palette.iconColor} size="sizeIcon10" />
      </Box>
      <Box>
        <Text
          as="div"
          fontSize="fontSize10"
          fontWeight="fontWeightSemibold"
          color={palette.title}
          lineHeight="lineHeight10"
        >
          {title}
        </Text>
        {subtitle && (
          <Text
            as="div"
            fontSize="fontSize10"
            color="colorTextWeak"
            lineHeight="lineHeight10"
          >
            {subtitle}
          </Text>
        )}
      </Box>
    </Box>
  );
};

const OutboundMessagePanel = (props) => {
  const fromNumbers = process.env.FLEX_APP_TWILIO_FROM_NUMBER.split(",");
  const whatsappFromNumbers = process.env.FLEX_APP_TWILIO_WHATSAPP_FROM_NUMBER.split(
    ","
  );

  const [toNumber, setToNumber] = useState(DEFAULT_TO_NUMBER);
  const [messageBody, setMessageBody] = useState("");
  const [messageType, setMessageType] = useState(DEFAULT_MESSAGE_TYPE);
  const [contentTemplateSid, setContentTemplateSid] = useState("");
  const [contentTemplates, setContentTemplates] = useState([]);
  const [variableValues, setVariableValues] = useState({});
  const [sessionInfo, setSessionInfo] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [fromNumber, setFromNumber] = useState(
    DEFAULT_MESSAGE_TYPE === "whatsapp" ? whatsappFromNumbers[0] : fromNumbers[0]
  );

  const isOutboundMessagePanelOpen = useFlexSelector(
    (state) =>
      state.flex.view.componentViewStates?.outboundMessagePanel
        ?.isOutboundMessagePanelOpen
  );
  const worker = useFlexSelector((state) => state.flex.worker);

  const toNumberValid = isToNumberValid(toNumber);
  const isWhatsApp = messageType === "whatsapp";

  const selectedTemplate = useMemo(
    () => contentTemplates.find((t) => t.sid === contentTemplateSid) || null,
    [contentTemplates, contentTemplateSid]
  );

  const placeholders = useMemo(
    () => (selectedTemplate ? extractPlaceholders(selectedTemplate.body) : []),
    [selectedTemplate]
  );

  const allVariablesFilled = placeholders.every(
    (k) => variableValues[k] && variableValues[k].toString().length > 0
  );

  const sessionErrored = sessionInfo?.error === true;
  const withinWindow = sessionInfo?.withinWindow === true;
  const knowsOutsideWindow =
    isWhatsApp &&
    sessionInfo &&
    !sessionErrored &&
    sessionInfo.withinWindow === false;

  const templateReady =
    contentTemplateSid && (placeholders.length === 0 || allVariablesFilled);

  const shouldBlockSend = (() => {
    if (!toNumberValid) return true;
    if (!isWhatsApp) return messageBody.length === 0;
    if (knowsOutsideWindow) return !templateReady;
    return !(messageBody.length > 0 || templateReady);
  })();

  let friendlyPhoneNumber = null;
  const formatter = new AsYouTypeFormatter();
  [...toNumber].forEach((c) => (friendlyPhoneNumber = formatter.inputDigit(c)));

  const handleSendClicked = (menuItemClicked) => {
    const variablesToSend =
      contentTemplateSid && placeholders.length > 0
        ? placeholders.reduce((acc, key) => {
            acc[key] = variableValues[key] || "";
            return acc;
          }, {})
        : undefined;

    onSendClickHandler(
      menuItemClicked,
      toNumber,
      fromNumber,
      messageType,
      messageBody,
      contentTemplateSid,
      variablesToSend
    );
  };

  useEffect(() => {
    if (isWhatsApp) {
      setFromNumber(whatsappFromNumbers[0]);
      fetchContentTemplates("whatsapp").then((t) =>
        setContentTemplates(t || [])
      );
    } else {
      setFromNumber(fromNumbers[0]);
      setContentTemplates([]);
      setContentTemplateSid("");
      setVariableValues({});
      setSessionInfo(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageType]);

  useEffect(() => {
    if (selectedTemplate) {
      setVariableValues({ ...(selectedTemplate.variables || {}) });
    } else {
      setVariableValues({});
    }
  }, [selectedTemplate]);

  const sessionTimer = useRef(null);
  const sessionRequestId = useRef(0);
  useEffect(() => {
    if (!isWhatsApp || !toNumberValid || !fromNumber) {
      setSessionInfo(null);
      return undefined;
    }
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    setSessionLoading(true);
    const myRequestId = ++sessionRequestId.current;
    sessionTimer.current = setTimeout(async () => {
      const result = await checkWhatsAppSession(
        "whatsapp:" + toNumber,
        "whatsapp:" + fromNumber
      );
      if (myRequestId !== sessionRequestId.current) return;
      setSessionInfo(result);
      setSessionLoading(false);
    }, 500);
    return () => {
      if (sessionTimer.current) clearTimeout(sessionTimer.current);
    };
  }, [isWhatsApp, toNumber, toNumberValid, fromNumber]);

  if (!isOutboundMessagePanelOpen) {
    if (toNumber !== DEFAULT_TO_NUMBER) setToNumber(DEFAULT_TO_NUMBER);
    if (messageBody.length) setMessageBody("");
    return null;
  }

  const displayAllTemplates =
    String(process.env.FLEX_APP_DISPLAY_ALL_TEMPLATE ?? "1").trim() !== "0";
  const allowedTemplateSids = (process.env.FLEX_APP_TWILIO_WHATSAPP_TEMPLATES || "")
    .replace(/[[\]]/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const templateOptions =
    displayAllTemplates || allowedTemplateSids.length === 0
      ? contentTemplates
      : contentTemplates.filter((t) => allowedTemplateSids.includes(t.sid));
  const freeFormDisabled = isWhatsApp && knowsOutsideWindow;

  let sessionChip = null;
  if (isWhatsApp && toNumberValid) {
    if (sessionErrored) {
      sessionChip = (
        <StatusChip
          tone="neutral"
          icon={InformationIcon}
          title="Session check unavailable"
          subtitle="Free-form allowed at your own risk"
        />
      );
    } else if (sessionLoading && !sessionInfo) {
      sessionChip = (
        <StatusChip
          tone="neutral"
          icon={LoadingIcon}
          title="Checking session…"
        />
      );
    } else if (withinWindow) {
      sessionChip = (
        <StatusChip
          tone="success"
          icon={CheckmarkCircleIcon}
          title="Session active"
          subtitle={`Replied ${timeAgo(sessionInfo.lastInboundAt)}`}
        />
      );
    } else if (knowsOutsideWindow) {
      sessionChip = (
        <StatusChip
          tone="warning"
          icon={WarningIcon}
          title="Template required"
          subtitle={
            sessionInfo.hasActiveConversation
              ? "No reply in 24h"
              : "New conversation"
          }
        />
      );
    }
  }

  return (
    <Container>
      <StyledSidePanel
        displayName="Message"
        themeOverride={props.theme && props.theme.OutboundDialerPanel}
        handleCloseClick={handleClose}
        title="Message"
      >
        {isWorkerAvailable(worker) && (
          <>
            {/* Message Type Selection */}
            <MessageTypeContainer theme={props.theme}>
              <RadioGroup
                name="messageType"
                value={messageType}
                legend="Message type"
                onChange={(newValue) => {
                  setMessageType(newValue);
                  setMessageBody("");
                  setContentTemplateSid("");
                }}
                orientation="horizontal"
              >
                <Radio id="sms" value="sms" name="sms">
                  SMS
                </Radio>
                <Radio id="whatsapp" value="whatsapp" name="whatsapp">
                  WhatsApp
                </Radio>
              </RadioGroup>
              <Text
                as="div"
                paddingTop={props.theme.tokens.spacings.space20}
                fontSize="fontSize10"
                color={
                  toNumberValid
                    ? props.theme.tokens.textColors.colorTextSuccess
                    : props.theme.tokens.textColors.colorTextWeak
                }
              >
                {isWhatsApp ? "whatsapp:" + toNumber : friendlyPhoneNumber}
              </Text>
            </MessageTypeContainer>

            {/* Dialer (with numeric keypad) */}
            <DialerContainer theme={props.theme}>
              <Dialer
                key="dialer"
                onDial={setToNumber}
                defaultPhoneNumber={toNumber}
                onPhoneNumberChange={setToNumber}
                hideActions
                disabled={false}
                defaultCountryAlpha2Code={DEFAULT_COUNTRY}
              />
            </DialerContainer>

            {((!isWhatsApp && fromNumbers.length > 1) ||
              (isWhatsApp && whatsappFromNumbers.length > 1)) && (
              <MessageContainer theme={props.theme}>
                <Label htmlFor="select_from_number">Send from</Label>
                <Select
                  id="select_from_number"
                  onChange={(e) => setFromNumber(e.target.value)}
                  value={fromNumber}
                >
                  <Option value="" disabled>
                    Select a number
                  </Option>
                  {(isWhatsApp ? whatsappFromNumbers : fromNumbers).map(
                    (number) => (
                      <Option value={number} key={number}>
                        {number}
                      </Option>
                    )
                  )}
                </Select>
              </MessageContainer>
            )}

            {sessionChip && (
              <MessageContainer theme={props.theme}>{sessionChip}</MessageContainer>
            )}

            {/* Message body + selector */}
            <MessageContainer theme={props.theme}>
              <Label htmlFor="message-body">Message</Label>
              <TextArea
                onChange={(event) => {
                  setMessageBody(event.target.value);
                  if (event.target.value && contentTemplateSid) {
                    setContentTemplateSid("");
                  }
                }}
                id="message-body"
                name="message-body"
                placeholder={
                  freeFormDisabled
                    ? "Free-form disabled — pick a template"
                    : "Type a message"
                }
                value={messageBody}
                disabled={freeFormDisabled}
              />
              {freeFormDisabled && (
                <Text
                  as="div"
                  fontSize="fontSize10"
                  color="colorTextWarningStrong"
                  lineHeight="lineHeight10"
                  marginTop="space20"
                >
                  Template required to start this conversation.
                </Text>
              )}

              <Box paddingY="space20">
                <Separator orientation="horizontal" verticalSpacing="space20" />
              </Box>

              <Label htmlFor="select_template">
                {isWhatsApp ? "WhatsApp template" : "Canned message"}
              </Label>
              {isWhatsApp ? (
                <>
                  <Select
                    id="select_template"
                    onChange={(e) => {
                      setContentTemplateSid(e.target.value);
                      if (e.target.value) setMessageBody("");
                    }}
                    value={contentTemplateSid}
                  >
                    <Option value="">Select a template…</Option>
                    {templateOptions.map((template) => (
                      <Option value={template.sid} key={template.sid}>
                        {template.name}
                      </Option>
                    ))}
                  </Select>
                  <Text
                    as="div"
                    fontSize="fontSize10"
                    color="colorTextWeak"
                    lineHeight="lineHeight10"
                    marginTop="space20"
                  >
                    Only business-initiated templates are shown.
                  </Text>

                  {selectedTemplate && placeholders.length > 0 && (
                    <Box marginTop="space40">
                      <Text
                        as="div"
                        fontSize="fontSize10"
                        fontWeight="fontWeightSemibold"
                        color="colorTextWeak"
                        marginBottom="space20"
                        style={{
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        Variables
                      </Text>
                      {placeholders.map((key) => (
                        <Box marginBottom="space20" key={key}>
                          <Label htmlFor={`var-${key}`}>{`{{${key}}}`}</Label>
                          <Input
                            id={`var-${key}`}
                            type="text"
                            value={variableValues[key] || ""}
                            onChange={(e) =>
                              setVariableValues((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }))
                            }
                          />
                        </Box>
                      ))}
                    </Box>
                  )}

                  {selectedTemplate && (
                    <Box
                      marginTop="space40"
                      padding="space30"
                      backgroundColor="colorBackgroundPrimaryWeakest"
                      borderColor="colorBorderPrimaryWeaker"
                      borderStyle="solid"
                      borderWidth="borderWidth10"
                      borderRadius="borderRadius20"
                    >
                      <Text
                        as="div"
                        fontSize="fontSize10"
                        fontWeight="fontWeightSemibold"
                        color="colorTextWeak"
                        marginBottom="space20"
                        style={{
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        Preview
                      </Text>
                      <Text
                        as="div"
                        fontSize="fontSize20"
                        color="colorText"
                        lineHeight="lineHeight20"
                        style={{ whiteSpace: "pre-wrap" }}
                      >
                        {renderPreview(selectedTemplate.body, variableValues) ||
                          "(no body)"}
                      </Text>
                    </Box>
                  )}
                </>
              ) : (
                <>
                  <Select
                    id="select_template"
                    onChange={(e) => setMessageBody(e.target.value)}
                    value={messageBody}
                  >
                    {templates.map((template) => (
                      <Option value={template} key={template}>
                        {template || "Type a message"}
                      </Option>
                    ))}
                  </Select>
                  <Text
                    as="div"
                    fontSize="fontSize10"
                    color="colorTextWeak"
                    lineHeight="lineHeight10"
                    marginTop="space20"
                  >
                    Choose a predefined message.
                  </Text>
                </>
              )}
            </MessageContainer>

            <SendMessageContainer theme={props.theme}>
              <SendMessageMenu
                disableSend={shouldBlockSend}
                onClickHandler={handleSendClicked}
              />
            </SendMessageContainer>
          </>
        )}
        {!isWorkerAvailable(worker) && (
          <OfflineContainer theme={props.theme}>
            <ErrorIcon />
            {`To send a message, please change your status from ${worker.activity.name}`}
          </OfflineContainer>
        )}
      </StyledSidePanel>
    </Container>
  );
};

export default OutboundMessagePanel;
