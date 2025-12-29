// WinTeam API Types - Generated from OpenAPI spec

// API Response Wrapper
export interface WinTeamResponse<T> {
  data: T;
  success: boolean;
  serverResponse: string;
}

export interface WinTeamPaginatedResponse<T> {
  data: {
    pageNumber: number;
    pageSize: number;
    totalPages: number;
    totalCount: number;
    results: T[];
  };
  success: boolean;
  serverResponse: string;
}

// Employee by Location
export interface WinTeamEmployeeByLocation {
  links: WinTeamLink[];
  employeeNumber: number;
  firstName: string;
  lastName: string;
  primaryJob: number;
  titleDescription: string;
  employmentStatus: string;
}

export interface WinTeamLink {
  rel: string;
  href: string;
  method: string;
}

// Employee General Info
export interface WinTeamEmployee {
  links: WinTeamLink[];
  employeeNumber: number;
  employeeId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  classificationId: number;
  emailAddress: string | null;
  locationId: number;
  phone1: number | null;
  phone1DescriptionId: number | null;
  phone1Extension: string | null;
  phone2: number | null;
  phone2DescriptionId: number | null;
  phone2Extension: string | null;
  phone3: number | null;
  phone3DescriptionId: number | null;
  phone3Extension: string | null;
  hireDate: string;
  birthDate: string | null;
  typeId: number;
  typeDescription: string;
  supervisorId: number | null;
  primaryJob: number;
  statusId: number;
  statusDescription: string;
  address: WinTeamAddress;
  physicalAddress: WinTeamAddress | null;
}

export interface WinTeamAddress {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: number | null;
  latitude: number | null;
  longitude: number | null;
}

// Compliance Items - The key endpoint for license tracking
export interface WinTeamComplianceItem {
  id: number;
  description: string;
  performanceId: number;
  skipped: boolean;
  failed: boolean;
  externalId: string | null;
  dueDate: string | null;
  dateCompleted: string | null;
  score: number;
  frequency: string | null;
  frequencyID: number | null;
  notes: string | null;
  systemNotes: string | null;
  imageFilePath: string | null;
  expirationDate: string | null;
  licenseExpirationCode: WinTeamLicenseExpirationCode | null;
}

export interface WinTeamLicenseExpirationCode {
  dateApplied: string | null;
  pendingDate: string | null;
  dateRevoked: string | null;
  extensionDate: string | null;
  statusId: number;
  status: string; // "Issued", "Pending", "Revoked"
  number: string; // License number
  licenseStage: string; // "Active", "Expired"
  licenseStageId: number;
}

// API Client Configuration
export interface WinTeamConfig {
  baseUrl: string;
  tenantId: string;
}
