// Active TaskRouter assignment statuses. `completed` and `canceled` tasks
// linger in the workspace after they've been wrapped up — they must NOT be
// treated as "an open chat already exists" or the plugin will refuse every
// subsequent outbound to that customer.
const ACTIVE_STATUSES = ["pending", "reserved", "assigned", "wrapping"];

exports.taskDetailsFromConversationSid = async (
  client,
  workspaceSid,
  conversationSid
) => {
  const tasks = await client.taskrouter.v1.workspaces(workspaceSid).tasks.list({
    evaluateTaskAttributes: `conversationSid == "${conversationSid}"`,
    assignmentStatus: ACTIVE_STATUSES,
    limit: 20,
  });

  if (!tasks || !tasks.length) return undefined;

  // Take the newest active task — there should usually be at most one.
  const task = tasks.sort(
    (a, b) => new Date(b.dateCreated) - new Date(a.dateCreated)
  )[0];

  return {
    taskExists: true,
    taskDirection: JSON.parse(task.attributes)?.direction,
    taskSid: task.sid,
  };
};

exports.agentNameFromIdentity = async (client, workspaceSid, agentIdentity) => {
  if (!agentIdentity) return undefined;

  const workers = await client.taskrouter.v1
    .workspaces(workspaceSid)
    .workers.list({ friendlyName: agentIdentity });

  if (!workers || !workers.length) return undefined;

  const worker = workers[0];
  return JSON.parse(worker.attributes)?.full_name;
};
