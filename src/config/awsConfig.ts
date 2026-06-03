/**
 * awsConfig.ts — AWS SDK Configuration
 *
 * Initialises the AWS SDK with the region and credentials needed to interact
 * with the S3 bucket that stores encrypted attendance log bundles.
 *
 * Security note:
 *   In production, credentials should NEVER be hard-coded.  The recommended
 *   pattern for mobile apps is:
 *     1. Device authenticates to a Lambda endpoint (using a device token).
 *     2. Lambda uses STS AssumeRole to obtain temporary credentials.
 *     3. Temporary credentials are returned and used for a single S3 PUT.
 *
 *   For the hackathon demo, the LAMBDA_ENDPOINT approach in syncService.ts
 *   follows this model — the app never holds long-lived AWS credentials.
 *
 * This file only exports the region and bucket name constants used by
 * syncService.ts.  The AWS SDK (aws-sdk) is configured lazily in syncService
 * using the temporary credentials returned by the Lambda.
 */

import { SYNC } from '@config/constants';

/** AWS region where PRAHARI resources are deployed */
export const AWS_REGION = SYNC.REGION;

/** S3 bucket for encrypted attendance log uploads */
export const S3_BUCKET = SYNC.S3_BUCKET;

/** Lambda endpoint that issues S3 pre-signed PUT URLs */
export const LAMBDA_ENDPOINT = SYNC.LAMBDA_ENDPOINT;

/**
 * Builds the S3 object key for a batch of attendance logs.
 * Format: prahari/logs/<deviceId>/<timestamp>.json
 *
 * Using a per-device, per-timestamp key prevents write conflicts when multiple
 * field devices sync concurrently.
 *
 * @param deviceId  Unique device identifier (e.g., from expo-device)
 * @param timestamp ISO-8601 timestamp string
 */
export const buildS3Key = (deviceId: string, timestamp: string): string =>
  `prahari/logs/${deviceId}/${timestamp}.json`;
