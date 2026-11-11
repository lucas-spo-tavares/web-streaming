import {
  DynamoDBClient,
  BatchGetItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { config, required } from '@/config';

const dynamo = new DynamoDBClient({ region: config.AWS_REGION });

export interface RetentionRecord {
  expires?: Date;
  deleting: boolean;
}
function record(item?: Record<string, AttributeValue>): RetentionRecord {
  const expires = item?.expiresAt?.N;
  if (expires !== undefined && !Number.isFinite(Number(expires)))
    throw new Error('Invalid retention record');
  return {
    expires: expires === undefined ? undefined : new Date(Number(expires)),
    deleting: item?.deleting?.BOOL === true,
  };
}
function conditionalFailure(error: unknown) {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}
export async function get(key: string): Promise<RetentionRecord> {
  const table = required('RETENTION_TABLE');
  const result = await dynamo.send(
    new GetItemCommand({ TableName: table, Key: { key: { S: key } }, ConsistentRead: true }),
  );
  return record(result.Item);
}
export async function batch(keys: string[]): Promise<Map<string, RetentionRecord>> {
  const table = required('RETENTION_TABLE');
  const records = new Map<string, RetentionRecord>();
  if (!keys.length) return records;
  let pending = {
    [table]: { Keys: keys.map((key) => ({ key: { S: key } })), ConsistentRead: true },
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await dynamo.send(new BatchGetItemCommand({ RequestItems: pending }));
    for (const item of result.Responses?.[table] ?? []) {
      if (!item.key?.S) throw new Error('Invalid retention key');
      records.set(item.key.S, record(item));
    }
    const remaining = result.UnprocessedKeys?.[table]?.Keys;
    if (!remaining?.length) return records;
    pending = {
      [table]: { Keys: remaining as { key: { S: string } }[], ConsistentRead: true },
    };
    await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
  }
  // Never treat throttled reads as absent renewals: that could expire a renewed video.
  throw new Error('Retention read incomplete');
}
export async function renew(key: string, until: Date): Promise<boolean> {
  const table = required('RETENTION_TABLE');
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: table,
        Key: { key: { S: key } },
        UpdateExpression: 'SET expiresAt = :until',
        ConditionExpression: 'attribute_not_exists(#deleting)',
        ExpressionAttributeNames: { '#deleting': 'deleting' },
        ExpressionAttributeValues: { ':until': { N: String(until.getTime()) } },
      }),
    );
    return true;
  } catch (error) {
    if (conditionalFailure(error)) return false;
    throw error;
  }
}
export async function claimDeletion(key: string, now?: number): Promise<boolean> {
  const table = required('RETENTION_TABLE');
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: table,
        Key: { key: { S: key } },
        UpdateExpression: 'SET #deleting = :yes, purgeAt = :purge',
        ExpressionAttributeNames: { '#deleting': 'deleting' },
        ExpressionAttributeValues: {
          ':yes': { BOOL: true },
          ':purge': { N: String(Math.floor(((now ?? Date.now()) + 7 * 86400000) / 1000)) },
          ...(now === undefined ? {} : { ':now': { N: String(now) } }),
        },
        ...(now === undefined
          ? {}
          : {
              ConditionExpression:
                'attribute_not_exists(expiresAt) OR expiresAt <= :now OR #deleting = :yes',
            }),
      }),
    );
    return true;
  } catch (error) {
    if (conditionalFailure(error)) return false;
    throw error;
  }
}
