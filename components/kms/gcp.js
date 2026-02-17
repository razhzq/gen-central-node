/**
 * GCP KMS Utility
 * Handles creation, revocation, and signing operations for IoT meter keys.
 *
 * Required env vars:
 *   GCP_PROJECT_ID              - GCP project ID
 *   GCP_LOCATION                - KMS location (default: global)
 *   GCP_KEY_RING                - KMS key ring name (default: gen-iot-keyring)
 *   GOOGLE_APPLICATION_CREDENTIALS - path to service account JSON
 */

const { KeyManagementServiceClient } = require('@google-cloud/kms');

let _client = null;

function getClient() {
  if (!_client) {
    _client = new KeyManagementServiceClient();
  }
  return _client;
}

function getKeyRingName() {
  const project  = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION  || 'global';
  const keyRing  = process.env.GCP_KEY_RING   || 'gen-iot-keyring';

  if (!project) throw new Error('GCP_PROJECT_ID env var is not set');

  return getClient().keyRingPath(project, location, keyRing);
}

/**
 * Create an Ed25519 signing key for a meter.
 * Returns { keyVersionName, publicKeyPem }
 */
async function createMeterKey(meterId) {
  const client      = getClient();
  const keyRingName = getKeyRingName();
  const cryptoKeyId = `meter-${meterId}`;

  // Create the CryptoKey (Ed25519, SOFTWARE protection)
  const [cryptoKey] = await client.createCryptoKey({
    parent: keyRingName,
    cryptoKeyId,
    cryptoKey: {
      purpose: 'ASYMMETRIC_SIGN',
      versionTemplate: {
        algorithm: 'EC_SIGN_ED25519',
        protectionLevel: process.env.GCP_KMS_PROTECTION_LEVEL || 'SOFTWARE',
      },
      // Disable automatic rotation — IoT keys are static
      destroyScheduledDuration: { seconds: 86400 }, // 24h grace before destroy
    },
  });

  // The first key version is created automatically
  const keyVersionName = `${cryptoKey.name}/cryptoKeyVersions/1`;

  // Fetch and cache the public key
  const [publicKey] = await client.getPublicKey({ name: keyVersionName });

  return {
    keyVersionName,
    publicKeyPem: publicKey.pem,
  };
}

/**
 * Destroy (revoke) a meter's signing key version.
 * The key enters a scheduled-destroy state and is wiped after the grace period.
 */
async function revokeMeterKey(keyVersionName) {
  const client = getClient();
  await client.destroyCryptoKeyVersion({ name: keyVersionName });
}

/**
 * Fetch the public key PEM for a given key version.
 * Used to verify signatures from an IoT node.
 */
async function getPublicKey(keyVersionName) {
  const client = getClient();
  const [publicKey] = await client.getPublicKey({ name: keyVersionName });
  return publicKey.pem;
}

/**
 * Sign a digest using a KMS key version.
 * digest must be a Buffer containing the SHA-256 hash of the data.
 * Returns the signature as a Buffer.
 */
async function signWithKey(keyVersionName, digestBuffer) {
  const client = getClient();
  const [response] = await client.asymmetricSign({
    name: keyVersionName,
    digest: { sha256: digestBuffer },
  });
  return Buffer.from(response.signature);
}

module.exports = { createMeterKey, revokeMeterKey, getPublicKey, signWithKey };
