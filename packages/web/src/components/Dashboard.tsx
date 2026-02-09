import { useState } from "react";
import type { TreasuryState, PendingPayment, CurvePoint, GroupConfig } from "../store/treasury";
import type { ScannedNote } from "../lib/balanceScanner";
import { ReceiveModal } from "./ReceiveModal";
import { WithdrawModal } from "./WithdrawModal";

type Tab = "dashboard" | "payment" | "transactions" | "audit";

interface DashboardProps {
  state: TreasuryState;
  onTabChange: (tab: Tab) => void;
  pendingPayments: PendingPayment[];
  isScanning?: boolean;
  noteCount?: number;
  balanceLoaded?: boolean;
  onRefresh: () => void;
  groupPublicKey: CurvePoint | null;
  viewingPublicKey: CurvePoint | null;
  onDeposited: () => void;
  notes?: ScannedNote[];
  groupConfig?: GroupConfig | null;
  onCreateWithdraw?: (payment: PendingPayment) => void;
}

function truncateHex(hex: string, chars = 8): string {
  if (hex.length <= chars * 2 + 4) return hex;
  return hex.slice(0, chars + 2) + "..." + hex.slice(-chars);
}

export function Dashboard({ state, onTabChange, pendingPayments, isScanning, noteCount, balanceLoaded, onRefresh, groupPublicKey, viewingPublicKey, onDeposited, notes, groupConfig, onCreateWithdraw }: DashboardProps) {
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);

  return (
    <div className="space-y-6">
      {/* Balance Hero Card */}
      <div className="bg-dark-card rounded-xl border border-dark-border shadow-card p-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-base text-slate-400">Total balance</p>
              <button
                onClick={onRefresh}
                disabled={isScanning}
                className="text-slate-400 hover:text-pavv-400 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Refresh balance"
              >
                <svg className={`w-4 h-4 ${isScanning ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              </button>
            </div>
            <p className="text-4xl font-bold text-white">
              {!balanceLoaded && !isScanning ? (
                <span className="text-slate-400 animate-pulse">Loading...</span>
              ) : isScanning && !balanceLoaded ? (
                <span className="text-slate-400 animate-pulse">Scanning...</span>
              ) : (
                <>{state.balance} <span className="text-xl font-normal text-slate-400">CFX</span></>
              )}
            </p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-pavv-500/15 rounded-full">
                <svg className="w-4 h-4 text-pavv-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                <span className="text-sm font-medium text-pavv-400">Shielded on Conflux eSpace</span>
              </span>
              {isScanning && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-dark-surface rounded-full">
                  <div className="w-3 h-3 border-2 border-pavv-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-slate-400">Scanning...</span>
                </span>
              )}
              {!isScanning && noteCount !== undefined && noteCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-dark-surface rounded-full">
                  <span className="text-sm text-slate-400">{noteCount} note{noteCount !== 1 ? "s" : ""}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDepositModal(true)}
              className="px-5 py-3 bg-pavv-500 hover:bg-pavv-600 text-white font-semibold rounded-lg text-base transition-colors duration-200 cursor-pointer flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
              </svg>
              Deposit
            </button>
            <button
              onClick={() => onTabChange("payment")}
              className="px-5 py-3 border border-dark-border hover:bg-dark-surface text-slate-300 font-semibold rounded-lg text-base transition-colors duration-200 cursor-pointer flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
              Send
            </button>
            <button
              onClick={() => setShowWithdrawModal(true)}
              className="px-5 py-3 border border-dark-border hover:bg-dark-surface text-slate-300 font-semibold rounded-lg text-base transition-colors duration-200 cursor-pointer flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
              </svg>
              Withdraw
            </button>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left Column - 2 cols */}
        <div className="col-span-2 space-y-6">
          {/* Top Assets */}
          <div className="bg-dark-card rounded-xl border border-dark-border shadow-card">
            <div className="px-6 py-4 border-b border-dark-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Top assets</h2>
            </div>
            <div className="divide-y divide-dark-border">
              <div className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-dark-surface rounded-full flex items-center justify-center">
                    <span className="text-base font-bold text-slate-400">C</span>
                  </div>
                  <div>
                    <p className="text-base font-medium text-white">Conflux</p>
                    <p className="text-sm text-slate-400">CFX</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-base font-semibold text-white">
                    {!balanceLoaded ? <span className="text-slate-400 animate-pulse">...</span> : <>{state.balance} CFX</>}
                  </p>
                  <span className="text-sm font-medium px-2.5 py-0.5 rounded-full bg-pavv-500/15 text-pavv-400">
                    Shielded
                  </span>
                </div>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-dark-border">
              <button className="text-sm font-medium text-pavv-400 hover:text-pavv-300 transition-colors duration-200 cursor-pointer">
                View all assets
              </button>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-dark-card rounded-xl border border-dark-border shadow-card">
            <div className="px-6 py-4 border-b border-dark-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Recent activity</h2>
              <span className="text-sm text-slate-400">{state.recentActivity.length} events</span>
            </div>
            <div className="divide-y divide-dark-border">
              {state.recentActivity.length === 0 ? (
                <p className="px-6 py-8 text-slate-400 text-base text-center">No activity yet</p>
              ) : (
                state.recentActivity.slice(0, 6).map((item) => (
                  <div key={item.id} className="px-6 py-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${
                          item.status === "success"
                            ? "bg-pavv-500"
                            : item.status === "pending"
                              ? "bg-yellow-500"
                              : "bg-red-500"
                        }`}
                      />
                      <span className="text-base text-slate-300">{item.description}</span>
                    </div>
                    <span className="text-sm text-slate-400">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column - 1 col */}
        <div className="space-y-6">
          {/* Pending Transactions */}
          <div className="bg-dark-card rounded-xl border border-dark-border shadow-card">
            <div className="px-6 py-4 border-b border-dark-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Pending transactions</h2>
              {pendingPayments.length > 0 && (
                <span className="text-sm font-semibold px-2.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
                  {pendingPayments.length}
                </span>
              )}
            </div>
            {pendingPayments.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <svg className="w-9 h-9 text-slate-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                </svg>
                <p className="text-base text-slate-400">No transactions to sign</p>
              </div>
            ) : (
              <div className="divide-y divide-dark-border">
                {pendingPayments.slice(0, 4).map((payment) => (
                  <div key={payment.id} className="px-6 py-3.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-base font-medium text-white">{payment.amount} CFX</span>
                      <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${
                        payment.status === "pending"
                          ? "bg-yellow-500/15 text-yellow-400"
                          : "bg-blue-500/15 text-blue-400"
                      }`}>
                        {payment.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400">
                      {payment.signatures.length}/{payment.requiredSignatures} signatures
                    </p>
                  </div>
                ))}
              </div>
            )}
            {pendingPayments.length > 0 && (
              <div className="px-6 py-3 border-t border-dark-border">
                <button
                  onClick={() => onTabChange("transactions")}
                  className="text-sm font-medium text-pavv-400 hover:text-pavv-300 transition-colors duration-200 cursor-pointer"
                >
                  View all
                </button>
              </div>
            )}
          </div>

          {/* Treasury Info */}
          <div className="bg-dark-card rounded-xl border border-dark-border shadow-card p-6">
            <h3 className="text-base font-semibold text-white mb-3">Treasury info</h3>
            <div className="space-y-3">
              {state.groupConfig && (
                <div className="flex items-center justify-between text-base">
                  <span className="text-slate-400">Group</span>
                  <span className="text-slate-200 font-medium">{state.groupConfig.name}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-base">
                <span className="text-slate-400">MPC Threshold</span>
                <span className="text-slate-200 font-medium">
                  {state.groupConfig ? `${state.groupConfig.threshold}-of-${state.groupConfig.totalSigners}` : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span className="text-slate-400">Curve</span>
                <span className="text-slate-200 font-medium">Grumpkin</span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span className="text-slate-400">Network</span>
                <span className="text-slate-200 font-medium">Conflux eSpace</span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span className="text-slate-400">Privacy</span>
                <span className="text-pavv-400 font-medium">Fully Shielded</span>
              </div>
              {groupPublicKey && (
                <div className="flex items-center justify-between text-base">
                  <span className="text-slate-400">Spending PK</span>
                  <span className="text-slate-200 font-mono text-sm">{truncateHex(groupPublicKey.x)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Treasury Info Bar */}
      <div className="bg-dark-card rounded-xl border border-dark-border shadow-card px-6 py-3 flex items-center justify-between text-sm text-slate-400">
        <span>{state.groupConfig?.name ?? "Treasury"}</span>
        <span className="text-dark-border">|</span>
        <span>MPC {state.groupConfig ? `${state.groupConfig.threshold}-of-${state.groupConfig.totalSigners}` : "threshold"}</span>
        <span className="text-dark-border">|</span>
        <span>Grumpkin (BN254 cycle)</span>
        <span className="text-dark-border">|</span>
        <span>Conflux eSpace</span>
        <span className="text-dark-border">|</span>
        <span className="text-pavv-400 font-medium">Fully Shielded</span>
      </div>

      {groupPublicKey && viewingPublicKey && (
        <ReceiveModal
          open={showDepositModal}
          onClose={() => setShowDepositModal(false)}
          groupPublicKey={groupPublicKey}
          viewingPublicKey={viewingPublicKey}
          onDeposited={onDeposited}
        />
      )}

      <WithdrawModal
        open={showWithdrawModal}
        onClose={() => setShowWithdrawModal(false)}
        notes={notes}
        groupPublicKey={groupPublicKey}
        groupConfig={groupConfig}
        onCreateWithdraw={onCreateWithdraw ?? (() => {})}
      />
    </div>
  );
}
