export function buildBridgeWorkflowRequest(input: {
  task: string;
  mode: unknown;
  allowedUserId: string;
  noExternalWrite: unknown;
}) {
  if (input.noExternalWrite !== undefined && typeof input.noExternalWrite !== 'boolean') {
    throw new TypeError('noExternalWrite must be a boolean');
  }
  return {
    task: input.task,
    mode: input.mode ?? 'write',
    noExternalWrite: input.noExternalWrite ?? false,
    userId: input.allowedUserId,
    chatId: input.allowedUserId,
  };
}
