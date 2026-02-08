import type { SignerRole, ShareData, CurvePoint, GroupConfig } from "../store/treasury";

// ── Types ──

export interface StoredPasskeyShare {
  name: string;
  role: SignerRole;
  credentialId: string; // base64url
  salt: string; // base64url, 32 bytes
  iv: string; // base64url, 12 bytes
  ciphertext: string; // base64url, AES-GCM encrypted
  usedPrf: boolean;
  createdAt: string; // ISO 8601
  groupName?: string;
  threshold?: number;
  totalSigners?: number;
}

export interface EncryptedSharePayload {
  share: ShareData;
  groupPublicKey: CurvePoint;
  viewingPublicKey: CurvePoint;
  groupConfig?: GroupConfig;
}

export interface PasskeyResult {
  ok: boolean;
  error?: string;
}

export interface DecryptResult {
  ok: boolean;
  payload?: EncryptedSharePayload;
  error?: string;
}

// ── Constants ──

const STORAGE_KEY = "pavv:passkey-shares";
const RP_NAME = "PAVV Treasury";
const RP_ID = window.location.hostname;

// ── localStorage CRUD ──

export function getStoredShares(): StoredPasskeyShare[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredPasskeyShare[];
  } catch {
    return [];
  }
}

export function hasStoredShares(): boolean {
  return getStoredShares().length > 0;
}

function addStoredShare(entry: StoredPasskeyShare): void {
  const shares = getStoredShares();
  shares.push(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shares));
}

export function removeStoredShare(credentialId: string): void {
  const shares = getStoredShares().filter(
    (s) => s.credentialId !== credentialId
  );
  if (shares.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shares));
  }
}

// ── Base64url helpers ──

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlToBuffer(b64url: string): ArrayBuffer {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ── Crypto helpers ──

async function deriveAesKey(
  ikm: ArrayBuffer,
  salt: ArrayBuffer
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: new TextEncoder().encode("pavv-passkey-share"),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptPayload(
  key: CryptoKey,
  iv: Uint8Array,
  data: EncryptedSharePayload
): Promise<ArrayBuffer> {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  return crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
}

async function decryptPayload(
  key: CryptoKey,
  iv: ArrayBuffer,
  ciphertext: ArrayBuffer
): Promise<EncryptedSharePayload> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json) as EncryptedSharePayload;
}

// ── Public API ──

export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials !== "undefined"
  );
}

export async function registerPasskeyForShare(
  name: string,
  share: ShareData,
  groupPublicKey: CurvePoint,
  viewingPublicKey: CurvePoint,
  groupConfig?: GroupConfig
): Promise<PasskeyResult> {
  try {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const createOptions: CredentialCreationOptions = {
      publicKey: {
        rp: { name: RP_NAME, id: RP_ID },
        user: {
          id: userId,
          name: `${name} (${share.role})`,
          displayName: name,
        },
        challenge,
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" },
        ],
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
        timeout: 60000,
        attestation: "none",
        extensions: {
          // @ts-ignore — PRF extension not in lib.dom.d.ts yet
          prf: {
            eval: {
              first: salt.buffer,
            },
          },
        },
      },
    };

    const credential = (await navigator.credentials.create(
      createOptions
    )) as PublicKeyCredential | null;

    if (!credential) {
      return { ok: false, error: "Passkey creation was cancelled" };
    }

    const extResults = (credential.getClientExtensionResults() as any)?.prf as
      | { enabled?: boolean; results?: { first: ArrayBuffer } }
      | undefined;

    let ikm: ArrayBuffer;
    let usedPrf = false;

    if (extResults?.results?.first) {
      ikm = extResults.results.first;
      usedPrf = true;
    } else {
      // Fallback: derive from rawId (less secure but functional for demo)
      ikm = credential.rawId;
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await deriveAesKey(ikm, salt.buffer);

    const payload: EncryptedSharePayload = {
      share,
      groupPublicKey,
      viewingPublicKey,
      groupConfig,
    };

    const ciphertext = await encryptPayload(aesKey, iv, payload);

    const entry: StoredPasskeyShare = {
      name,
      role: share.role,
      credentialId: bufferToBase64url(credential.rawId),
      salt: bufferToBase64url(salt.buffer),
      iv: bufferToBase64url(iv.buffer),
      ciphertext: bufferToBase64url(ciphertext),
      usedPrf,
      createdAt: new Date().toISOString(),
      groupName: groupConfig?.name,
      threshold: groupConfig?.threshold,
      totalSigners: groupConfig?.totalSigners,
    };

    addStoredShare(entry);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Passkey registration failed";
    return { ok: false, error: message };
  }
}

/**
 * Show all stored passkeys in the system dialog and decrypt whichever the user picks.
 */
export async function authenticateAnyShare(
  entries: StoredPasskeyShare[]
): Promise<DecryptResult> {
  if (entries.length === 0) {
    return { ok: false, error: "No stored passkeys found" };
  }

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const requestOptions: CredentialRequestOptions = {
      publicKey: {
        challenge,
        rpId: RP_ID,
        allowCredentials: entries.map((e) => ({
          id: base64urlToBuffer(e.credentialId),
          type: "public-key" as const,
        })),
        userVerification: "required",
        timeout: 60000,
      },
    };

    const credential = (await navigator.credentials.get(
      requestOptions
    )) as PublicKeyCredential | null;

    if (!credential) {
      return { ok: false, error: "Passkey authentication was cancelled" };
    }

    const returnedId = bufferToBase64url(credential.rawId);
    const matched = entries.find((e) => e.credentialId === returnedId);

    if (!matched) {
      return { ok: false, error: "No matching share found for this passkey" };
    }

    // Now do a second auth with PRF for the matched entry
    return authenticateAndDecryptShare(matched);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Passkey authentication failed";
    return { ok: false, error: message };
  }
}

export async function authenticateAndDecryptShare(
  entry: StoredPasskeyShare
): Promise<DecryptResult> {
  try {
    const saltBuffer = base64urlToBuffer(entry.salt);
    const credIdBuffer = base64urlToBuffer(entry.credentialId);
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const requestOptions: CredentialRequestOptions = {
      publicKey: {
        challenge,
        rpId: RP_ID,
        allowCredentials: [
          {
            id: credIdBuffer,
            type: "public-key",
          },
        ],
        userVerification: "required",
        timeout: 60000,
        extensions: {
          // @ts-ignore — PRF extension not in lib.dom.d.ts yet
          prf: {
            eval: {
              first: saltBuffer,
            },
          },
        },
      },
    };

    const credential = (await navigator.credentials.get(
      requestOptions
    )) as PublicKeyCredential | null;

    if (!credential) {
      return { ok: false, error: "Passkey authentication was cancelled" };
    }

    const extResults = (credential.getClientExtensionResults() as any)?.prf as
      | { results?: { first: ArrayBuffer } }
      | undefined;

    let ikm: ArrayBuffer;

    if (entry.usedPrf && extResults?.results?.first) {
      ikm = extResults.results.first;
    } else if (!entry.usedPrf) {
      // Fallback path: derive from rawId
      ikm = credential.rawId;
    } else {
      return { ok: false, error: "PRF not available during authentication" };
    }

    const aesKey = await deriveAesKey(ikm, saltBuffer);
    const ivBuffer = base64urlToBuffer(entry.iv);
    const ciphertextBuffer = base64urlToBuffer(entry.ciphertext);

    const payload = await decryptPayload(aesKey, ivBuffer, ciphertextBuffer);

    // Keep the share in localStorage so user can login again later
    return { ok: true, payload };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Passkey authentication failed";
    return { ok: false, error: message };
  }
}
