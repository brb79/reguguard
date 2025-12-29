import {
    WinTeamConfig,
    WinTeamResponse,
    WinTeamPaginatedResponse,
    WinTeamEmployee,
    WinTeamEmployeeByLocation,
    WinTeamComplianceItem,
} from './types';

export class WinTeamClient {
    private baseUrl: string;
    private tenantId: string;

    constructor(config: WinTeamConfig) {
        this.baseUrl = config.baseUrl || 'https://apim.myteamsoftware.com/wtnextgen/employees/v1';
        this.tenantId = config.tenantId;
    }

    private async request<T>(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;

        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'tenantId': this.tenantId,
                ...options.headers,
            },
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(
                `WinTeam API error: ${response.status} ${response.statusText} - ${JSON.stringify(error)}`
            );
        }

        return response.json();
    }

    /**
     * Get employees by location with pagination
     */
    async getEmployeesByLocation(
        locationId: number,
        options?: {
            pageSize?: number;
            pageNumber?: number;
            searchFieldName?: string;
            searchText?: string;
            orderBy?: string;
            ascending?: boolean;
        }
    ): Promise<WinTeamPaginatedResponse<WinTeamEmployeeByLocation>> {
        const params = new URLSearchParams();
        if (options?.pageSize) params.set('pageSize', options.pageSize.toString());
        if (options?.pageNumber) params.set('pageNumber', options.pageNumber.toString());
        if (options?.searchFieldName) params.set('searchFieldName', options.searchFieldName);
        if (options?.searchText) params.set('searchText', options.searchText);
        if (options?.orderBy) params.set('orderBy', options.orderBy);
        if (options?.ascending !== undefined) params.set('ascending', options.ascending.toString());

        const query = params.toString() ? `?${params.toString()}` : '';
        return this.request(`/api/locations/${locationId}/${query}`);
    }

    /**
     * Get all employees from a location (handles pagination)
     */
    async getAllEmployeesByLocation(locationId: number): Promise<WinTeamEmployeeByLocation[]> {
        const allEmployees: WinTeamEmployeeByLocation[] = [];
        let pageNumber = 1;
        let totalPages = 1;

        do {
            const response = await this.getEmployeesByLocation(locationId, {
                pageSize: 100,
                pageNumber,
            });

            if (response.success && response.data.results) {
                allEmployees.push(...response.data.results);
                totalPages = response.data.totalPages;
            }
            pageNumber++;
        } while (pageNumber <= totalPages);

        return allEmployees;
    }

    /**
     * Get employee general information
     */
    async getEmployee(employeeKey: string | number): Promise<WinTeamResponse<WinTeamEmployee[]>> {
        return this.request(`/api/employees/${employeeKey}/`);
    }

    /**
     * Get compliance items (licenses) for an employee
     * This is the key endpoint for license expiration tracking
     */
    async getComplianceItems(
        employeeNumber: number
    ): Promise<WinTeamResponse<WinTeamComplianceItem[]>> {
        return this.request(`/api/employees/${employeeNumber}/compliance-items/`);
    }

    /**
     * Sync all compliance data for employees at a location
     */
    async syncLocationCompliance(
        locationId: number,
        onProgress?: (current: number, total: number) => void
    ): Promise<{
        employees: WinTeamEmployee[];
        complianceItems: Map<number, WinTeamComplianceItem[]>;
    }> {
        // Get all employees at location
        const employeeList = await this.getAllEmployeesByLocation(locationId);
        const employees: WinTeamEmployee[] = [];
        const complianceItems = new Map<number, WinTeamComplianceItem[]>();

        let current = 0;
        const total = employeeList.length;

        for (const emp of employeeList) {
            try {
                // Get full employee details
                const empResponse = await this.getEmployee(emp.employeeNumber);
                if (empResponse.success && empResponse.data.length > 0) {
                    employees.push(empResponse.data[0]);
                }

                // Get compliance items
                const compResponse = await this.getComplianceItems(emp.employeeNumber);
                if (compResponse.success && compResponse.data) {
                    complianceItems.set(emp.employeeNumber, compResponse.data);
                }

                current++;
                onProgress?.(current, total);
            } catch (error) {
                console.error(`Error syncing employee ${emp.employeeNumber}:`, error);
            }
        }

        return { employees, complianceItems };
    }

    /**
     * Update a compliance item (license) for an employee
     * Uses JSON Patch format per WinTeam API spec
     * 
     * @see https://apim.myteamsoftware.com/wtnextgen/employees/v1 - PATCH /api/employees/{employeeKey}/compliance-items/{complianceId}
     */
    async updateComplianceItem(
        employeeNumber: number,
        complianceId: number,
        updates: {
            expirationDate?: string;      // ISO date format
            licenseNumber?: string;
            licenseStageId?: number;      // 1 = Active, 2 = Expired
            statusId?: number;            // 1 = Pending, 2 = Applied, 3 = Issued
            notes?: string;
            dateApplied?: string;
        }
    ): Promise<{ success: boolean; error?: string }> {
        // Build JSON Patch operations
        const patchOps: Array<{ op: 'replace'; path: string; value: unknown }> = [];

        if (updates.expirationDate) {
            patchOps.push({
                op: 'replace',
                path: '/expirationDate',
                value: updates.expirationDate,
            });
        }

        if (updates.licenseNumber) {
            patchOps.push({
                op: 'replace',
                path: '/licenseExpirationCode/number',
                value: updates.licenseNumber,
            });
        }

        if (updates.licenseStageId !== undefined) {
            patchOps.push({
                op: 'replace',
                path: '/licenseExpirationCode/licenseStageId',
                value: updates.licenseStageId,
            });
        }

        if (updates.statusId !== undefined) {
            patchOps.push({
                op: 'replace',
                path: '/licenseExpirationCode/statusId',
                value: updates.statusId,
            });
        }

        if (updates.notes) {
            patchOps.push({
                op: 'replace',
                path: '/notes',
                value: updates.notes,
            });
        }

        if (updates.dateApplied) {
            patchOps.push({
                op: 'replace',
                path: '/licenseExpirationCode/dateApplied',
                value: updates.dateApplied,
            });
        }

        if (patchOps.length === 0) {
            return { success: false, error: 'No updates provided' };
        }

        try {
            await this.request(
                `/api/employees/${employeeNumber}/compliance-items/${complianceId}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify(patchOps),
                }
            );
            return { success: true };
        } catch (error) {
            console.error('WinTeam PATCH error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}

// Export singleton factory
let clientInstance: WinTeamClient | null = null;

export function getWinTeamClient(config?: WinTeamConfig): WinTeamClient {
    if (!clientInstance && config) {
        clientInstance = new WinTeamClient(config);
    }
    if (!clientInstance) {
        throw new Error('WinTeam client not initialized. Provide config on first call.');
    }
    return clientInstance;
}
