'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface DashboardStats {
    expiringLicenses: number;
    pendingRenewals: number;
    activeAlerts: number;
    recentSyncs: number;
}

export default function DashboardPage() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function loadStats() {
            try {
                const supabase = createClient();
                
                // Get expiring licenses (next 30 days)
                const thirtyDaysFromNow = new Date();
                thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                
                const { count: expiringCount } = await supabase
                    .from('licenses_cache')
                    .select('*', { count: 'exact', head: true })
                    .not('expiration_date', 'is', null)
                    .lte('expiration_date', thirtyDaysFromNow.toISOString().split('T')[0])
                    .gte('expiration_date', new Date().toISOString().split('T')[0]);

                // Get pending renewals
                const { count: pendingCount } = await supabase
                    .from('pending_renewals')
                    .select('*', { count: 'exact', head: true })
                    .eq('confirmed', false);

                // Get active alerts
                const { count: alertsCount } = await supabase
                    .from('alerts')
                    .select('*', { count: 'exact', head: true })
                    .eq('status', 'pending');

                // Get recent syncs (last 24 hours)
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                
                const { count: syncsCount } = await supabase
                    .from('sync_jobs')
                    .select('*', { count: 'exact', head: true })
                    .gte('started_at', yesterday.toISOString());

                setStats({
                    expiringLicenses: expiringCount || 0,
                    pendingRenewals: pendingCount || 0,
                    activeAlerts: alertsCount || 0,
                    recentSyncs: syncsCount || 0,
                });
                setLoading(false);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load dashboard');
                setLoading(false);
            }
        }

        loadStats();
    }, []);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="text-lg text-zinc-600">Loading dashboard...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="text-lg text-red-600">Error: {error}</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-50 p-8">
            <div className="mx-auto max-w-7xl">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold text-zinc-900">ReguGuard Dashboard</h1>
                    <p className="mt-2 text-zinc-600">Compliance monitoring and license management</p>
                </header>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <StatCard
                        title="Expiring Licenses"
                        value={stats?.expiringLicenses || 0}
                        description="Next 30 days"
                        color="yellow"
                    />
                    <StatCard
                        title="Pending Renewals"
                        value={stats?.pendingRenewals || 0}
                        description="Awaiting approval"
                        color="blue"
                    />
                    <StatCard
                        title="Active Alerts"
                        value={stats?.activeAlerts || 0}
                        description="Pending notifications"
                        color="red"
                    />
                    <StatCard
                        title="Recent Syncs"
                        value={stats?.recentSyncs || 0}
                        description="Last 24 hours"
                        color="green"
                    />
                </div>

                {/* Quick Actions */}
                <div className="mt-8">
                    <h2 className="mb-4 text-xl font-semibold text-zinc-900">Quick Actions</h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <ActionCard
                            title="View Expiring Licenses"
                            description="See all licenses expiring soon"
                            href="/dashboard/licenses"
                        />
                        <ActionCard
                            title="Pending Renewals"
                            description="Review and approve license renewals"
                            href="/dashboard/renewals"
                        />
                        <ActionCard
                            title="Sync WinTeam"
                            description="Sync employee data from WinTeam"
                            href="/dashboard/sync"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({
    title,
    value,
    description,
    color,
}: {
    title: string;
    value: number;
    description: string;
    color: 'yellow' | 'blue' | 'red' | 'green';
}) {
    const colorClasses = {
        yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
        blue: 'bg-blue-50 border-blue-200 text-blue-800',
        red: 'bg-red-50 border-red-200 text-red-800',
        green: 'bg-green-50 border-green-200 text-green-800',
    };

    return (
        <div className={`rounded-lg border p-6 ${colorClasses[color]}`}>
            <div className="text-sm font-medium opacity-75">{title}</div>
            <div className="mt-2 text-4xl font-bold">{value}</div>
            <div className="mt-1 text-sm opacity-75">{description}</div>
        </div>
    );
}

function ActionCard({
    title,
    description,
    href,
}: {
    title: string;
    description: string;
    href: string;
}) {
    return (
        <a
            href={href}
            className="block rounded-lg border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md"
        >
            <h3 className="font-semibold text-zinc-900">{title}</h3>
            <p className="mt-2 text-sm text-zinc-600">{description}</p>
        </a>
    );
}

