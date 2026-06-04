/**
 * awsConfig.ts — AWS / Sync Endpoint Configuration
 *
 * For the hackathon demo, point to the local mock server:
 *   Run: node mock-server/index.js
 *
 * Android emulator:  http://10.0.2.2:3001/sync  (10.0.2.2 = host machine)
 * Physical device:   http://<your-LAN-IP>:3001/sync
 *
 * For production: replace with your Lambda URL.
 */

import { SYNC } from '@config/constants';

/** Lambda / mock-server endpoint that accepts attendance log batches */
export const LAMBDA_ENDPOINT = 'http://10.0.2.2:3001/sync';
// Physical device on same WiFi — replace with your machine's LAN IP:
// export const LAMBDA_ENDPOINT = 'http://192.168.1.100:3001/sync';

/** AWS region (used for S3 key construction even in mock mode) */
export const AWS_REGION = SYNC.REGION;

/** S3 bucket name (not used in mock mode) */
export const S3_BUCKET = SYNC.S3_BUCKET;

/**
 * Builds the S3 object key for a batch upload.
 * Format: prahari/logs/<deviceId>/<timestamp>.json
 */
export const buildS3Key = (deviceId: string, timestamp: string): string =>
  `prahari/logs/${deviceId}/${timestamp}.json`;
