# Automated State Requirements Monitoring

This feature automatically monitors state regulatory websites for changes in security guard licensing requirements, extracts updated information using AI, and generates compliance impact reports.

## Overview

The automated state requirements research system:

1. **Monitors** state regulatory websites for changes
2. **Extracts** updated requirements automatically using Google Gemini AI
3. **Updates** metadata.json files when changes are detected
4. **Flags** breaking changes that require immediate attention
5. **Generates** compliance impact reports with actionable recommendations

## Architecture

### Components

- **`src/lib/state-requirements/scraper.ts`** - Web scraping service for regulatory websites
- **`src/lib/state-requirements/ai-extractor.ts`** - AI-powered extraction using Gemini
- **`src/lib/state-requirements/change-detector.ts`** - Change detection algorithms
- **`src/lib/state-requirements/impact-reporter.ts`** - Impact report generation
- **`src/lib/state-requirements/metadata-updater.ts`** - Metadata file management
- **`src/lib/state-requirements/monitoring-service.ts`** - Main orchestration service

### Database Tables

- **`state_requirements_monitoring`** - Tracks monitoring job history
- **`state_requirements_changes`** - Records detected changes
- **`compliance_impact_reports`** - Stores generated impact reports

## Usage

### Scheduled Monitoring (Cron Job)

The system includes a cron endpoint that can be scheduled to run automatically:

```
GET /api/cron/state-requirements-monitor
```

**Vercel Cron Configuration:**
```json
{
  "crons": [
    {
      "path": "/api/cron/state-requirements-monitor",
      "schedule": "0 2 * * 0"
    }
  ]
}
```

This runs every Sunday at 2 AM to check all states for changes.

### Manual Monitoring

Trigger monitoring manually for a specific state or all states:

```bash
# Monitor all states
GET /api/state-requirements/monitor

# Monitor specific state
GET /api/state-requirements/monitor?state=VA

# Monitor without updating metadata files
GET /api/state-requirements/monitor?state=VA&update=false
```

### Query Changes and Reports

```bash
# Get latest changes for a state
GET /api/state-requirements/changes?state=VA&limit=20

# Get impact reports for a state
GET /api/state-requirements/reports?state=VA&limit=10
```

## Change Detection

The system detects and classifies changes:

### Breaking Changes (Critical)
- License type removals
- Training hour requirement changes
- Renewal period changes
- Initial/renewal requirement changes
- Background check requirement changes

### Non-Breaking Changes (Medium/Low)
- Fee changes
- Contact information updates
- Training topic updates
- Regulatory body website changes

## Impact Reports

When changes are detected, the system automatically generates impact reports that include:

- **Summary** - Overview of detected changes
- **Breaking Changes** - Critical changes requiring immediate action
- **Non-Breaking Changes** - Updates that don't affect compliance
- **Affected License Types** - Which license types are impacted
- **Estimated Impact** - Human-readable impact description
- **Recommendations** - Actionable steps to address changes

## Configuration

### Environment Variables

Required:
- `GOOGLE_AI_API_KEY` - For AI extraction (uses Gemini 1.5 Flash)

### Database Migration

Run the migration to create the monitoring tables:

```bash
# Apply migration 004_state_requirements_monitoring.sql
```

## Monitoring Flow

1. **Read Existing Metadata** - Loads current `metadata.json` for the state
2. **Get Sources** - Extracts URLs from regulatory_body and sources fields
3. **Scrape Websites** - Fetches content from regulatory websites
4. **AI Extraction** - Uses Gemini to extract structured requirements
5. **Change Detection** - Compares old vs new metadata
6. **Impact Analysis** - Generates reports for detected changes
7. **Metadata Update** - Updates `metadata.json` files (if enabled)
8. **Database Logging** - Records monitoring history and changes

## Example Response

```json
{
  "success": true,
  "timestamp": "2024-12-27T10:00:00Z",
  "summary": {
    "total": 1,
    "completed": 1,
    "changes_detected": 1,
    "failed": 0
  },
  "results": [
    {
      "success": true,
      "state_code": "VA",
      "status": "changes_detected",
      "sources_checked": [
        "https://www.dcjs.virginia.gov"
      ],
      "changes_detected": [
        {
          "change_type": "breaking",
          "field_path": "license_types[armed_security_officer].initial_training_hours",
          "old_value": 40,
          "new_value": 48,
          "description": "Initial training hours changed from 40 to 48 hours",
          "severity": "critical"
        }
      ]
    }
  ]
}
```

## Integration with Existing Subagent

This automated system complements the existing `state-requirements-researcher.md` subagent:

- **Subagent**: Manual research and initial state documentation
- **Automated Monitoring**: Ongoing change detection and updates

The automated system uses the same metadata structure created by the subagent, ensuring consistency.

## Limitations

- Web scraping may fail if websites change structure or block requests
- AI extraction accuracy depends on website content quality
- Some states may require manual verification of extracted data
- Rate limiting may apply to frequent monitoring

## Future Enhancements

- Email notifications for breaking changes
- Dashboard UI for viewing changes and reports
- Webhook support for external integrations
- Advanced change detection with machine learning
- Multi-source verification for accuracy

