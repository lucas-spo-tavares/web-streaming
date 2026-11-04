import { config } from '@/config';
import { AuthClient } from '@/lib/auth';

export const auth = new AuthClient(config);
