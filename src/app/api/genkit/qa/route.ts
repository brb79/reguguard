/**
 * Compliance Q&A Agent API Endpoint
 *
 * POST /api/genkit/qa
 *
 * Request body:
 * {
 *   question: string;
 *   employeeId: string;
 *   conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
 * }
 *
 * Response:
 * {
 *   answer: string;
 *   sources: string[];
 *   suggestedActions?: string[];
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@/lib/supabase/server';
import { readFileSync } from 'fs';
import { join } from 'path';

// Request validation schema
const requestSchema = z.object({
  question: z.string().min(1, 'Question is required'),
  employeeId: z.string().min(1, 'Employee ID is required'),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
});

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');

// Helper: Load state metadata
function loadStateMetadata(stateCode: string) {
  try {
    const metadataPath = join(process.cwd(), 'knowledge', 'states', stateCode, 'metadata.json');
    const content = readFileSync(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load metadata for state ${stateCode}:`, error);
    return null;
  }
}

// Helper: Get employee record
async function getEmployeeRecord(employeeId: string) {
  const supabase = await createClient();

  const { data: employee, error: empError } = await supabase
    .from('employees_cache')
    .select('first_name, last_name')
    .eq('id', employeeId)
    .single();

  if (empError || !employee) {
    return {
      name: 'Unknown Employee',
      licenses: [],
    };
  }

  const { data: licenses } = await supabase
    .from('licenses_cache')
    .select('description, matched_state, expiration_date, license_stage')
    .eq('employee_id', employeeId);

  const formattedLicenses = (licenses || []).map((license: any) => ({
    type: license.description || 'Unknown License',
    state: license.matched_state || 'Unknown',
    expirationDate: license.expiration_date || 'Unknown',
    status: license.license_stage || 'Unknown',
  }));

  return {
    name: `${(employee as any).first_name} ${(employee as any).last_name}`,
    licenses: formattedLicenses,
  };
}

export async function POST(req: NextRequest) {
  try {
    // Parse and validate request body
    const body = await req.json();
    const validationResult = requestSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const { question, employeeId, conversationHistory = [] } = validationResult.data;

    // Get employee data for context
    const employeeData = await getEmployeeRecord(employeeId);

    // Build context for AI
    let contextData = '';
    contextData += `\nEmployee Information:\n`;
    contextData += `- Name: ${employeeData.name}\n`;
    contextData += `- Licenses:\n`;
    for (const license of employeeData.licenses) {
      contextData += `  - ${license.type} (${license.state})\n`;
      contextData += `    Expires: ${license.expirationDate}\n`;
      contextData += `    Status: ${license.status}\n`;
    }

    // Load state regulations for any licenses
    for (const license of employeeData.licenses) {
      if (license.state && license.state !== 'Unknown') {
        const metadata = loadStateMetadata(license.state);
        if (metadata) {
          contextData += `\n${license.state} State Requirements:\n`;

          // Handle both old format (licenseTypes object) and new format (license_types array)
          const licenseTypes = (metadata as any).licenseTypes || (metadata as any).license_types || [];
          const typesArray = Array.isArray(licenseTypes) ? licenseTypes : Object.values(licenseTypes);

          for (const typeData of typesArray) {
            const displayName = (typeData as any).display_name || (typeData as any).name;
            const renewalTraining = (typeData as any).renewal_training_hours;
            const initialTraining = (typeData as any).initial_training_hours;

            contextData += `  - ${displayName}\n`;

            if (renewalTraining) {
              contextData += `    Renewal Training: ${renewalTraining} hours\n`;
            }
            if (initialTraining) {
              contextData += `    Initial Training: ${initialTraining} hours\n`;
            }

            // Include renewal requirements if available
            if ((typeData as any).requirements?.renewal) {
              contextData += `    Renewal Requirements: ${(typeData as any).requirements.renewal.join(', ')}\n`;
            }
          }

          // Add contact info if available
          if ((metadata as any).contact) {
            const contact = (metadata as any).contact;
            contextData += `\n  Contact: ${contact.phone || 'N/A'}\n`;
            if (contact.website || (metadata as any).regulatory_body?.website) {
              contextData += `  Website: ${contact.website || (metadata as any).regulatory_body?.website}\n`;
            }
          }
        }
      }
    }

    // Build conversation history
    const history = conversationHistory
      .map((msg: any) => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}`)
      .join('\n');

    // System prompt
    const systemPrompt = `You are a helpful compliance assistant for ReguGuard, a security guard license management platform.

Your role is to help security guards understand and manage their license renewals.

Guidelines:
- Be conversational and friendly, like a helpful colleague
- Keep responses concise and SMS-friendly (under 500 characters when possible)
- Use the employee and regulation data provided to give accurate information
- Provide actionable next steps when relevant
- Cite sources for regulatory information
- NEVER use commands like "Reply DONE" or "Text HELP" - always use natural conversational language

Employee Context:
${contextData}

${history ? `Conversation History:\n${history}\n` : ''}

User Question: ${question}

Respond with ONLY a JSON object in this format:
{
  "answer": "your conversational response",
  "sources": ["source 1", "source 2"],
  "suggestedActions": ["action 1", "action 2"]
}`;

    // Call Gemini
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
    });

    const result = await model.generateContent(systemPrompt);
    const responseText = result.response.text();

    // Parse JSON response
    let parsed;
    try {
      // Try direct parse
      parsed = JSON.parse(responseText);
    } catch {
      // Try extracting from markdown code block
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try finding JSON object in text
        const objectMatch = responseText.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          parsed = JSON.parse(objectMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      }
    }

    return NextResponse.json({
      answer: parsed.answer || responseText,
      sources: parsed.sources || [],
      suggestedActions: parsed.suggestedActions || undefined,
    });

  } catch (error) {
    console.error('Error in Q&A agent endpoint:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}

// Optionally support GET to check if endpoint is live
export async function GET() {
  return NextResponse.json({
    status: 'online',
    endpoint: '/api/genkit/qa',
    method: 'POST',
    description: 'Compliance Q&A Agent powered by Google Gemini',
  });
}
