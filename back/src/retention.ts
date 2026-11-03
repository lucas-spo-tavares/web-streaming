import {
  DynamoDBClient,
  BatchGetItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';

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
export class RetentionStore {
  constructor(
    private table: string,
    private client = new DynamoDBClient({}),
  ) {}
  async get(key: string): Promise<RetentionRecord> {
    const result = await this.client.send(
      new GetItemCommand({ TableName: this.table, Key: { key: { S: key } }, ConsistentRead: true }),
    );
    return record(result.Item);
  }
  async batch(keys: string[]): Promise<Map<string, RetentionRecord>> {
    const records = new Map<string, RetentionRecord>();
    if (!keys.length) return records;
    let pending = {
      [this.table]: { Keys: keys.map((key) => ({ key: { S: key } })), ConsistentRead: true },
    };
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await this.client.send(new BatchGetItemCommand({ RequestItems: pending }));
      for (const item of result.Responses?.[this.table] ?? []) {
        if (!item.key?.S) throw new Error('Invalid retention key');
        records.set(item.key.S, record(item));
      }
      const remaining = result.UnprocessedKeys?.[this.table]?.Keys;
      if (!remaining?.length) return records;
      pending = {
        [this.table]: { Keys: remaining as { key: { S: string } }[], ConsistentRead: true },
      };
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
    // Never treat throttled reads as absent renewals: that could expire a renewed video.
    throw new Error('Retention read incomplete');
  }
  async renew(key: string, until: Date): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateItemCommand({
          TableName: this.table,
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
  async claimDeletion(key: string, now?: number): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateItemCommand({
          TableName: this.table,
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
}
