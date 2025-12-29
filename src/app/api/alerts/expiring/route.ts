import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { LicenseWithEmployee } from '@/lib/supabase';
import { extractSingle } from '@/lib/supabase/query-types';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createServerClient();
        const { searchParams } = new URL(request.url);

        const clientId = searchParams.get('client_id');
        const days = parseInt(searchParams.get('days') || '30', 10);

        if (!clientId) {
            return NextResponse.json(
                { error: 'client_id is required' },
                { status: 400 }
            );
        }

        // Query licenses expiring within the specified days
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + days);

        type LicenseQueryResult = {
            id: string;
            description: string | null;
            license_number: string | null;
            expiration_date: string | null;
            license_stage: string | null;
            status: string | null;
            employee: {
                id: string;
                first_name: string | null;
                last_name: string | null;
                phone1: string | null;
                email: string | null;
                client_id: string | null;
            } | {
                id: string;
                first_name: string | null;
                last_name: string | null;
                phone1: string | null;
                email: string | null;
                client_id: string | null;
            }[];
        };

        const { data: licenses, error } = await supabase
            .from('licenses_cache')
            .select(`
        id,
        description,
        license_number,
        expiration_date,
        license_stage,
        status,
        employee:employees_cache!inner (
          id,
          first_name,
          last_name,
          phone1,
          email,
          client_id
        )
      `)
            .eq('employee.client_id', clientId)
            .not('expiration_date', 'is', null)
            .lte('expiration_date', futureDate.toISOString().split('T')[0])
            .order('expiration_date', { ascending: true }) as { data: LicenseQueryResult[] | null; error: unknown };

        if (error) {
            console.error('Query error:', error);
            return NextResponse.json(
                { error: 'Failed to query licenses' },
                { status: 500 }
            );
        }

        // Process and categorize results
        const expiring = (licenses || []).map((license) => {
            const emp = extractSingle(license.employee);

            const expirationDate = new Date(license.expiration_date!);
            const daysRemaining = Math.floor(
                (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
            );

            return {
                license_id: license.id,
                employee_id: emp?.id,
                employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
                phone: emp?.phone1,
                email: emp?.email,
                license_type: license.description,
                license_number: license.license_number,
                expiration_date: license.expiration_date,
                days_remaining: daysRemaining,
                status: daysRemaining < 0 ? 'expired' :
                    daysRemaining <= 7 ? 'critical' :
                        daysRemaining <= 14 ? 'warning' : 'upcoming',
            };
        });

        // Summary counts
        const summary = {
            total: expiring.length,
            expired: expiring.filter(l => l.days_remaining < 0).length,
            expiring_7d: expiring.filter(l => l.days_remaining >= 0 && l.days_remaining <= 7).length,
            expiring_14d: expiring.filter(l => l.days_remaining > 7 && l.days_remaining <= 14).length,
            expiring_30d: expiring.filter(l => l.days_remaining > 14 && l.days_remaining <= 30).length,
        };

        return NextResponse.json({
            expiring,
            summary,
        });
    } catch (error) {
        console.error('Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
