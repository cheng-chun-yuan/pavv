/**
 * BLSGun Treasury State Management
 *
 * Simple React state using useState/useReducer patterns.
 * Manages signers, pending transactions, and approval flow.
 *
 * SECURITY: The Redux store NEVER holds secret share scalars.
 * Secrets live only in the session-scoped ref (lib/session.ts).
 */

export type SignerRole = string;

export interface GroupConfig {
  name: string;
  threshold: number;
  totalSigners: number;
  roles: string[];
}

export interface CurvePoint {
  x: string;
  y: string;
}

export interface ShareData {
  index: number;
  role: SignerRole;
  secretShare: string;
  publicShare: CurvePoint;
}

export interface KeyCeremonyData {
  groupPublicKey: CurvePoint;
  viewingPublicKey: CurvePoint;
  shares: ShareData[];
}

export interface CeremonyTranscriptEntry {
  role: SignerRole;
  publicShare: CurvePoint;
  savedVia: "passkey" | "download";
  timestamp: number;
}

export interface Signer {
  role: SignerRole;
  index: number; // 1, 2, or 3
  hasKey: boolean;
}

export interface PendingPayment {
  id: string;
  recipient: string;
  amount: string;
  memo: string;
  createdBy: SignerRole;
  createdAt: number;
  signatures: SignerRole[];
  requiredSignatures: number;
  status: "pending" | "signing" | "proving" | "submitted" | "confirmed";
}

export interface TreasuryState {
  initialized: boolean;
  signers: Signer[];
  balance: string;
  pendingPayments: PendingPayment[];
  currentSigner: SignerRole | null;
  recentActivity: ActivityItem[];
  keyCeremony: KeyCeremonyData | null;
  ceremonyTranscript: CeremonyTranscriptEntry[];
  sessionExpiresAt: number | null;
  groupConfig: GroupConfig | null;
}

export interface ActivityItem {
  id: string;
  type: "shield" | "transfer" | "unshield" | "sign";
  description: string;
  timestamp: number;
  status: "success" | "pending" | "failed";
}

export const initialState: TreasuryState = {
  initialized: false,
  signers: [],
  balance: "0",
  pendingPayments: [],
  currentSigner: null,
  recentActivity: [],
  keyCeremony: null,
  ceremonyTranscript: [],
  sessionExpiresAt: null,
  groupConfig: null,
};

export type TreasuryAction =
  | { type: "INIT_KEYS"; keyCeremony: KeyCeremonyData; transcript: CeremonyTranscriptEntry[]; groupConfig: GroupConfig }
  | { type: "SET_SIGNER"; role: SignerRole }
  | { type: "SET_BALANCE"; balance: string }
  | { type: "CREATE_PAYMENT"; payment: PendingPayment }
  | { type: "ADD_SIGNATURE"; paymentId: string; signer: SignerRole }
  | { type: "UPDATE_STATUS"; paymentId: string; status: PendingPayment["status"] }
  | { type: "ADD_ACTIVITY"; activity: ActivityItem }
  | {
      type: "LOGIN_WITH_SHARE";
      share: ShareData;
      groupPublicKey: CurvePoint;
      viewingPublicKey: CurvePoint;
      groupConfig: GroupConfig | null;
    }
  | { type: "LOGOUT" }
  | { type: "SET_SESSION_EXPIRY"; expiresAt: number };

export function treasuryReducer(
  state: TreasuryState,
  action: TreasuryAction
): TreasuryState {
  switch (action.type) {
    case "INIT_KEYS": {
      const gc = action.groupConfig;
      return {
        ...state,
        initialized: true,
        groupConfig: gc,
        signers: gc.roles.map((role, i) => ({ role, index: i + 1, hasKey: true })),
        keyCeremony: action.keyCeremony,
        ceremonyTranscript: action.transcript,
        recentActivity: [
          {
            id: crypto.randomUUID(),
            type: "shield",
            description: `Treasury keys generated (${gc.threshold}-of-${gc.totalSigners} FROST)`,
            timestamp: Date.now(),
            status: "success",
          },
          ...state.recentActivity,
        ],
      };
    }

    case "SET_SIGNER":
      return { ...state, currentSigner: action.role };

    case "SET_BALANCE":
      return { ...state, balance: action.balance };

    case "CREATE_PAYMENT":
      return {
        ...state,
        pendingPayments: [action.payment, ...state.pendingPayments],
        recentActivity: [
          {
            id: crypto.randomUUID(),
            type: "transfer",
            description: `Payment of ${action.payment.amount} CFX initiated`,
            timestamp: Date.now(),
            status: "pending",
          },
          ...state.recentActivity,
        ],
      };

    case "ADD_SIGNATURE":
      return {
        ...state,
        pendingPayments: state.pendingPayments.map((p) =>
          p.id === action.paymentId
            ? { ...p, signatures: [...p.signatures, action.signer] }
            : p
        ),
        recentActivity: [
          {
            id: crypto.randomUUID(),
            type: "sign",
            description: `${action.signer} signed payment`,
            timestamp: Date.now(),
            status: "success",
          },
          ...state.recentActivity,
        ],
      };

    case "UPDATE_STATUS":
      return {
        ...state,
        pendingPayments: state.pendingPayments.map((p) =>
          p.id === action.paymentId ? { ...p, status: action.status } : p
        ),
      };

    case "ADD_ACTIVITY":
      return {
        ...state,
        recentActivity: [action.activity, ...state.recentActivity],
      };

    case "LOGIN_WITH_SHARE": {
      const { share, groupPublicKey, viewingPublicKey, groupConfig: gc } = action;
      const signers = gc
        ? gc.roles.map((role, i) => ({
            role,
            index: i + 1,
            hasKey: role === share.role,
          }))
        : [{ role: share.role, index: share.index, hasKey: true }];
      return {
        ...state,
        initialized: true,
        currentSigner: share.role,
        groupConfig: gc,
        keyCeremony: {
          groupPublicKey,
          viewingPublicKey,
          shares: [share],
        },
        signers,
        balance: "0",
        recentActivity: [
          {
            id: crypto.randomUUID(),
            type: "shield" as const,
            description: `${share.role} unlocked share via passkey`,
            timestamp: Date.now(),
            status: "success" as const,
          },
          ...state.recentActivity,
        ],
      };
    }

    case "LOGOUT":
      return {
        ...initialState,
      };

    case "SET_SESSION_EXPIRY":
      return {
        ...state,
        sessionExpiresAt: action.expiresAt,
      };

    default:
      return state;
  }
}
