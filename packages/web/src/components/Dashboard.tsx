import type { TreasuryState } from "../store/treasury";

interface DashboardProps {
  state: TreasuryState;
}

export function Dashboard({ state }: DashboardProps) {
  const pendingCount = state.pendingPayments.filter(
    (p) => p.status === "pending" || p.status === "signing"
  ).length;

  return (
    <div className="space-y-6">
      {/* Balance Card */}
      <div className="bg-gradient-to-br from-gun-800 to-gun-950 rounded-2xl p-6 border border-gun-700/50">
        <p className="text-sm text-gun-300 mb-1">Shielded Balance</p>
        <p className="text-4xl font-bold tracking-tight">
          {state.balance} <span className="text-xl text-gun-300">CFX</span>
        </p>
        <div className="mt-4 flex gap-4 text-sm text-gun-300">
          <span>2-of-3 FROST Protected</span>
          <span className="text-green-400">Fully Private</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <p className="text-sm text-gray-400">Pending Approvals</p>
          <p className="text-2xl font-bold mt-1">{pendingCount}</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <p className="text-sm text-gray-400">Signers Online</p>
          <p className="text-2xl font-bold mt-1">
            {state.signers.filter((s) => s.hasKey).length}/3
          </p>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <p className="text-sm text-gray-400">Transactions</p>
          <p className="text-2xl font-bold mt-1">
            {state.recentActivity.filter((a) => a.type === "transfer").length}
          </p>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-gray-900 rounded-xl border border-gray-800">
        <div className="p-4 border-b border-gray-800">
          <h2 className="font-semibold">Recent Activity</h2>
        </div>
        <div className="divide-y divide-gray-800">
          {state.recentActivity.length === 0 ? (
            <p className="p-4 text-gray-500 text-sm">No activity yet</p>
          ) : (
            state.recentActivity.slice(0, 10).map((item) => (
              <div key={item.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      item.status === "success"
                        ? "bg-green-400"
                        : item.status === "pending"
                          ? "bg-yellow-400"
                          : "bg-red-400"
                    }`}
                  />
                  <span className="text-sm">{item.description}</span>
                </div>
                <span className="text-xs text-gray-500">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
