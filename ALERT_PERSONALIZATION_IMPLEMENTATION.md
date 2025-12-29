# Smart Alert Personalization - Implementation Summary

## Overview

This document describes the implementation of **Smart Alert Personalization** (Feature #5 from AI_EXPANSION_PLAN.md), which transforms generic alert templates into AI-generated personalized messages based on employee history, state requirements, and behavioral patterns.

## Implementation Date
January 27, 2025

## Features Implemented

### 1. **AI-Powered Message Generation** ✅
- Uses Google Gemini Pro to generate personalized SMS messages
- Considers employee history, past behavior, and response patterns
- Adjusts tone based on urgency (30d = friendly, 7d = urgent, expired = critical)
- Includes state-specific renewal instructions when available

### 2. **Employee History Analysis** ✅
- Tracks past alerts, renewals, and response times
- Identifies behavior patterns (late renewals, on-time renewals)
- Calculates average response time from alert to renewal
- Determines preferred communication style

### 3. **State Requirements Integration** ✅
- Loads state-specific requirements from `knowledge/states/{STATE_CODE}/metadata.json`
- Includes renewal training hours, renewal periods, and requirements
- Adds regulatory body contact information
- Provides helpful context (fees, deadlines, training requirements)

### 4. **Multi-Language Support** ✅
- Detects preferred language from past SMS conversations
- Supports English (en) and Spanish (es) with extensibility for more languages
- Generates messages in the employee's preferred language

### 5. **A/B Testing Capabilities** ✅
- Randomly assigns variants (A or B) for testing
- Tracks response rates, renewal rates, and average response times
- Provides analytics API endpoint for comparing variant effectiveness
- Stores personalization metadata for analysis

### 6. **Graceful Fallback** ✅
- Falls back to template-based messages if AI is unavailable
- Handles errors gracefully without breaking alert sending
- Maintains backward compatibility with existing templates

## Files Created/Modified

### New Files

1. **`src/lib/ai/alert-personalization-service.ts`** (New)
   - Core personalization service
   - Employee history gathering
   - State requirements loading
   - Language detection
   - AI message generation

2. **`src/lib/ai/ab-testing-utils.ts`** (New)
   - A/B test metrics calculation
   - Variant comparison
   - Personalization statistics

3. **`src/app/api/alerts/ab-testing/route.ts`** (New)
   - API endpoint for A/B test analytics
   - Returns comparison metrics and statistics

4. **`supabase/migrations/007_alert_personalization.sql`** (New)
   - Adds `personalization_metadata` JSONB field to alerts table
   - Creates index for efficient querying

### Modified Files

1. **`src/lib/ai/index.ts`**
   - Exports alert personalization service

2. **`src/app/api/alerts/send/route.ts`**
   - Integrates personalization service
   - Generates personalized messages before sending
   - Stores personalization metadata

3. **`src/lib/supabase/types.ts`**
   - Adds `personalization_metadata` field to alerts table types

## Database Schema Changes

### Alerts Table
Added column:
- `personalization_metadata` (JSONB) - Stores:
  - `variant`: 'A' | 'B' | 'template'
  - `language`: Detected language code
  - `tone`: Message tone used
  - `personalizationFactors`: Array of factors used
  - `stateRequirementsIncluded`: Boolean
  - `employeeHistoryUsed`: Boolean

## API Endpoints

### POST `/api/alerts/send`
Enhanced to generate personalized messages. Response now includes:
```json
{
  "success": true,
  "total": 10,
  "sent": 10,
  "failed": 0,
  "results": [
    {
      "alert_id": "...",
      "success": true,
      "personalized": true,
      "variant": "A",
      "metadata": {
        "language": "en",
        "tone": "friendly",
        "personalizationFactors": ["employee_history", "state_requirements"]
      }
    }
  ]
}
```

### GET `/api/alerts/ab-testing`
Returns A/B test analytics:
```json
{
  "success": true,
  "dateRange": {
    "start": "2025-01-01T00:00:00Z",
    "end": "2025-01-31T23:59:59Z"
  },
  "comparison": {
    "variantA": { "renewalRate": 85.5, "responseRate": 92.3, ... },
    "variantB": { "renewalRate": 88.2, "responseRate": 94.1, ... },
    "template": { "renewalRate": 78.5, "responseRate": 85.2, ... },
    "winner": "B",
    "confidence": 0.85
  },
  "stats": {
    "totalAlerts": 1000,
    "personalizedAlerts": 850,
    "personalizationRate": 85.0,
    "averagePersonalizationFactors": 2.3
  }
}
```

## Usage

### Basic Usage
The personalization service is automatically used when sending alerts via `/api/alerts/send`. No code changes needed - it works transparently with existing alert sending.

### Manual Personalization
```typescript
import { alertPersonalizationService } from '@/lib/ai';

const personalized = await alertPersonalizationService.generatePersonalizedMessage({
  alertType: 'expiring_14d',
  employeeContext: {
    employeeId: '...',
    employeeName: 'John Doe',
    firstName: 'John',
    lastName: 'Doe',
    phoneNumber: '+1234567890',
    locationId: 123,
  },
  licenseContext: {
    licenseId: '...',
    licenseName: 'Armed Security Officer',
    licenseNumber: 'ABC123',
    expirationDate: '2025-02-15',
    daysRemaining: 14,
    stateCode: 'VA',
    licenseType: 'armed_security_officer',
  },
  enableABTesting: true,
});

console.log(personalized.message); // Personalized message
console.log(personalized.variant); // 'A' or 'B'
```

### A/B Testing Analytics
```typescript
import { compareABTestVariants } from '@/lib/ai/ab-testing-utils';

const comparison = await compareABTestVariants({
  start: new Date('2025-01-01'),
  end: new Date('2025-01-31'),
});

console.log(`Winner: ${comparison.winner} (confidence: ${comparison.confidence})`);
```

## Configuration

### Environment Variables
- `GOOGLE_AI_API_KEY` - Required for AI personalization (falls back to templates if not set)

### State Requirements
State requirements are automatically loaded from:
- `knowledge/states/{STATE_CODE}/metadata.json`

The service caches state requirements in memory for performance.

## Performance Considerations

1. **Caching**: State requirements are cached in memory
2. **Async Processing**: Employee history gathering is done asynchronously
3. **Fallback**: Template-based messages are used if AI is slow or unavailable
4. **Batch Processing**: Multiple alerts can be processed efficiently

## Error Handling

- AI failures gracefully fall back to templates
- Missing state requirements don't break personalization
- Missing employee history uses default behavior
- All errors are logged for debugging

## Future Enhancements

Potential improvements:
1. **Predictive Analytics**: Use ML to predict renewal likelihood
2. **Advanced Language Detection**: Use proper NLP libraries for better language detection
3. **Communication Style Learning**: Analyze past messages to learn preferred style
4. **Dynamic A/B Testing**: Automatically adjust variant distribution based on performance
5. **Multi-Channel Personalization**: Extend to email and other channels

## Testing

To test the implementation:

1. **Send Test Alert**:
   ```bash
   curl -X POST http://localhost:3000/api/alerts/send \
     -H "Content-Type: application/json" \
     -d '{"client_id": "...", "alert_ids": ["..."]}'
   ```

2. **Check A/B Test Results**:
   ```bash
   curl http://localhost:3000/api/alerts/ab-testing?start_date=2025-01-01&end_date=2025-01-31
   ```

3. **Verify Personalization**:
   - Check `personalization_metadata` field in alerts table
   - Verify messages are personalized based on employee history
   - Confirm state requirements are included when available

## Metrics to Track

Key metrics for measuring success:
- **Response Rate**: % of alerts that get acknowledged
- **Renewal Rate**: % of alerts that result in renewals
- **Average Response Time**: Days from alert to renewal
- **Personalization Rate**: % of alerts that use AI personalization
- **A/B Test Winner**: Which variant performs best

## Notes

- Personalization requires `GOOGLE_AI_API_KEY` to be set
- Falls back to templates if AI is unavailable (backward compatible)
- State requirements must exist in `knowledge/states/` directory
- A/B testing is enabled by default but can be disabled per request

