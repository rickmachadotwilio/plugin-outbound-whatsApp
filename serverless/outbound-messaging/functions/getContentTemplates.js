const TokenValidator = require("twilio-flex-token-validator").functionValidator;

// optional private asset in services that can contain list of content templates to return
// expected format:
// { enabled: true/false, filters: { "ACxxx" : [HXxxx] }
const contentTemplateAsset = Runtime.getAssets()["/contentTemplateFilters.js"];
let contentTemplateFilters = undefined;
const setContentTemplateFilters = (contentTemplateAsset) => {
  if (!contentTemplateAsset?.path) return undefined;
  contentTemplateFilters = require(contentTemplateAsset.path);
  return contentTemplateFilters;
};

const filterTemplates = (templateSid, accountSid) => {
  // just read the asset once if it exists. it will be cached when running in twilio
  if (contentTemplateAsset && !contentTemplateFilters) {
    contentTemplateFilters = setContentTemplateFilters(contentTemplateAsset);
  }

  if (!contentTemplateFilters) return true;
  if (!contentTemplateFilters?.filters?.enabled) return true;
  if (!contentTemplateFilters?.filters?.accounts[accountSid]) return true;

  const allowedContentTemplates =
    contentTemplateFilters.filters.accounts[accountSid];

  return allowedContentTemplates.includes(templateSid);
};

// Extract a preview body from the template's types object. Templates may be
// twilio/text, twilio/quick-reply, twilio/card, twilio/call-to-action, etc.
// Most carry a `body` field on the primary type object; fall back to the first
// type that has one.
const extractBody = (types) => {
  if (!types || typeof types !== "object") return "";
  for (const key of Object.keys(types)) {
    const entry = types[key];
    if (entry && typeof entry.body === "string" && entry.body.length) {
      return entry.body;
    }
  }
  return "";
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

  try {
    const client = context.getTwilioClient();
    const channel = (event.Channel || "").toLowerCase();

    // When the caller asks for the WhatsApp channel we use the v2
    // ContentAndApprovals endpoint filtered to WhatsApp-approved templates.
    // That set matches what the Content Template Builder labels as
    // "WhatsApp business initiated".
    //
    // The Node SDK bundled with twilio 4.x only exposes content.v1 as a
    // resource — we call the v2 REST endpoint through client.request()
    // and paginate manually.
    let rawTemplates = [];
    if (channel === "whatsapp") {
      let url =
        "https://content.twilio.com/v2/ContentAndApprovals?PageSize=100&ChannelEligibility=whatsapp%3Aapproved";
      // Follow next_page_url until exhausted; guard with a hard cap.
      for (let page = 0; page < 20 && url; page += 1) {
        const resp = await client.request({ method: "GET", uri: url });
        const body = resp.body || {};
        if (Array.isArray(body.contents)) {
          rawTemplates = rawTemplates.concat(
            body.contents.map((c) => ({
              sid: c.sid,
              friendlyName: c.friendly_name,
              language: c.language,
              variables: c.variables,
              types: c.types,
            }))
          );
        }
        url = body.meta && body.meta.next_page_url;
      }
    } else {
      const list = await client.content.v1.contents.list();
      rawTemplates = list.map((c) => ({
        sid: c.sid,
        friendlyName: c.friendlyName,
        language: c.language,
        variables: c.variables,
        types: c.types,
      }));
    }

    const formattedTemplates = rawTemplates
      .filter((template) => filterTemplates(template.sid, context.ACCOUNT_SID))
      .map((template) => ({
        sid: template.sid,
        name: template.friendlyName,
        language: template.language,
        variables: template.variables || {},
        body: extractBody(template.types),
      }));

    response.setStatusCode(200);
    response.setBody({ templates: formattedTemplates });

    return callback(null, response);
  } catch (error) {
    console.error("Error:", error);

    response.setStatusCode(500);
    response.setBody({
      error: true,
      message: error.message,
    });

    return callback(null, response);
  }
});
