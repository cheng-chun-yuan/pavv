/**
 * BLSGun Treasury State Management
 *
 * Simple React state using useState/useReducer patterns.
 * Manages signers, pending transactions, and approval flow.
 */

export type SignerRole = "Accountant" | "Manager" | "CFO";

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
  signers: [
    { role: "Accountant", index: 1, hasKey: false },
    { role: "Manager", index: 2, hasKey: false },
    { role: "CFO", index: 3, hasKey: false },
  ],
  balance: "0",
  pendingPayments: [],
  currentSigner: null,
  recentActivity: [],
};

export type TreasuryAction =
  | { type: "INIT_KEYS" }
  | { type: "SET_SIGNER"; role: SignerRole }
  | { type: "SET_BALANCE"; balance: string }
  | { type: "CREATE_PAYMENT"; payment: PendingPayment }
  | { type: "ADD_SIGNATURE"; paymentId: string; signer: SignerRole }
  | { type: "UPDATE_STATUS"; paymentId: string; status: PendingPayment["status"] }
  | { type: "ADD_ACTIVITY"; activity: ActivityItem };

export function treasuryReducer(
  state: TreasuryState,
  action: TreasuryAction
): TreasuryState {
  switch (action.type) {
    case "INIT_KEYS":
      return {
        ...state,
        initialized: true,
        signers: state.signers.map((s) => ({ ...s, hasKey: true })),
        recentActivity: [
          {
            id: crypto.randomUUID(),
            type: "shield",
            description: "Treasury keys generated (2-of-3 FROST)",
            timestamp: Date.now(),
            status: "success",
          },
          ...state.recentActivity,
        ],
      };

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

    default:
      return state;
  }
}
