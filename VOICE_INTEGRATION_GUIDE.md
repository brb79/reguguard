# Voice Integration Guide: Phone-Based Agent Conversations
## Enable Employees to Call and Talk to Compliance Agents

**Goal**: Add voice capability so employees can call a phone number and have natural conversations with your autonomous agents instead of SMS.

**Timeline**: 2-3 weeks after Phase 1 agent implementation
**Cost**: ~$0.02-0.05 per minute of conversation

---

## 🎯 Architecture Overview

### Voice-to-Agent Flow

```
Employee calls → Twilio Voice → Speech-to-Text → Claude Agent → Text-to-Speech → Employee hears
     │                                                   │
     └─── Same autonomous agents as SMS! ───────────────┘
```

**Key Insight**: Your Claude agents remain unchanged. You just add voice I/O layers.

---

## Option 1: Twilio Voice + Deepgram + ElevenLabs (RECOMMENDED)

### Why This Stack

✅ **Best quality**: Deepgram has superior real-time STT, ElevenLabs has natural TTS
✅ **Low latency**: <500ms for real-time conversations
✅ **Existing integration**: You already use Twilio for SMS
✅ **Agent-agnostic**: Works with any Claude agent
✅ **Cost-effective**: ~$0.03/minute all-in

### Architecture

```typescript
┌─────────────────────────────────────────────────────────┐
│  Employee Phone Call                                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Twilio Voice (Telephony)                                │
│  - Receives call                                         │
│  - Streams audio to your server                          │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  WebSocket Server (Next.js API Route)                   │
│  - Receives audio stream from Twilio                     │
│  - Sends audio to Deepgram STT                           │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Deepgram Speech-to-Text                                 │
│  - Real-time transcription                               │
│  - Returns text: "How much does my renewal cost?"        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Claude Compliance Agent (YOUR EXISTING AGENTS!)         │
│  - Receives text input                                   │
│  - Autonomously uses tools                               │
│  - Returns text: "Your TX renewal will cost $65..."      │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  ElevenLabs Text-to-Speech                               │
│  - Converts text to natural speech                       │
│  - Returns audio stream                                  │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Twilio Voice (plays audio to caller)                    │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation: Week 1-3

### Week 1: Setup Telephony Infrastructure

#### Day 1: Twilio Voice Configuration

**1. Get Twilio Phone Number**

```bash
# In Twilio Console
# Buy a phone number with Voice capability
# Example: +1-555-COMPLY (1-555-266-7759)
```

**2. Configure Webhook**

Set webhook URL for incoming calls:
```
https://your-app.vercel.app/api/voice/incoming
```

**3. Add Environment Variables**

```bash
# .env.local
TWILIO_ACCOUNT_SID=ACxxxxxxxxx
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE_NUMBER=+15552667759

# Deepgram (Speech-to-Text)
DEEPGRAM_API_KEY=your-deepgram-key

# ElevenLabs (Text-to-Speech)
ELEVENLABS_API_KEY=your-elevenlabs-key
```

#### Day 2-3: Install Dependencies

```bash
npm install @deepgram/sdk  # Speech-to-Text
npm install elevenlabs     # Text-to-Speech
npm install ws             # WebSocket for real-time audio streaming
npm install twilio         # Already installed
```

#### Day 4-5: Create Voice Webhook Endpoint

**File**: `src/app/api/voice/incoming/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';

/**
 * Incoming Voice Call Handler
 *
 * When employee calls, Twilio hits this endpoint
 * We return TwiML to establish WebSocket connection for streaming
 */

export async function POST(request: NextRequest) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  // Greet caller
  response.say(
    {
      voice: 'alice',
      language: 'en-US',
    },
    'Hello! Welcome to ReguGuard Compliance Assistant. How can I help you today?'
  );

  // Start audio stream to our WebSocket server
  const connect = response.connect();
  connect.stream({
    url: `wss://${request.headers.get('host')}/api/voice/stream`,
  });

  return new NextResponse(response.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  });
}
```

#### Day 6-7: Build WebSocket Stream Handler

**File**: `src/app/api/voice/stream/route.ts`

```typescript
import { createClient } from '@deepgram/sdk';
import { ElevenLabsClient } from 'elevenlabs';
import { complianceQAAgent } from '@/lib/agents/compliance-qa-agent';

/**
 * Real-time Voice Stream Handler
 *
 * Handles bidirectional audio streaming:
 * Twilio → Deepgram (STT) → Claude Agent → ElevenLabs (TTS) → Twilio
 */

const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY!,
});

export async function GET(request: Request) {
  // Upgrade to WebSocket
  const upgrade = request.headers.get('upgrade');
  if (upgrade !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }

  // This will be handled by WebSocket server
  // See implementation below
}

// WebSocket handler (using Next.js custom server or Vercel Edge Functions)
export const config = {
  runtime: 'edge', // Use Edge runtime for WebSocket support
};
```

**Better approach - Create dedicated WebSocket server**:

**File**: `src/lib/voice/stream-handler.ts`

```typescript
import WebSocket from 'ws';
import { createClient } from '@deepgram/sdk';
import { ElevenLabsClient, stream } from 'elevenlabs';
import { complianceQAAgent } from '@/lib/agents/compliance-qa-agent';

const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY!,
});

interface CallSession {
  callSid: string;
  employeeId?: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  deepgramConnection: any;
  streamSid?: string;
}

const activeSessions = new Map<string, CallSession>();

export function handleVoiceStream(ws: WebSocket, request: any) {
  console.log('New voice stream connection');

  let session: CallSession | null = null;

  ws.on('message', async (message: string) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          // New call starting
          session = await initializeCallSession(msg);
          activeSessions.set(msg.start.callSid, session);
          break;

        case 'media':
          // Audio chunk from Twilio
          if (session) {
            await processAudioChunk(session, msg.media);
          }
          break;

        case 'stop':
          // Call ended
          if (session) {
            await cleanupCallSession(session);
            activeSessions.delete(msg.stop.callSid);
          }
          break;
      }
    } catch (error) {
      console.error('Error processing voice message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Voice stream connection closed');
    if (session) {
      cleanupCallSession(session);
    }
  });
}

async function initializeCallSession(startMsg: any): Promise<CallSession> {
  const callSid = startMsg.start.callSid;
  const streamSid = startMsg.start.streamSid;

  // Initialize Deepgram live transcription
  const deepgramLive = deepgram.listen.live({
    model: 'nova-2',
    language: 'en-US',
    smart_format: true,
    interim_results: false, // Only get final transcriptions
    endpointing: 300, // Detect end of speech after 300ms silence
  });

  const session: CallSession = {
    callSid,
    streamSid,
    conversationHistory: [],
    deepgramConnection: deepgramLive,
  };

  // Listen for transcriptions
  deepgramLive.on('transcript', async (transcription: any) => {
    const transcript = transcription.channel.alternatives[0].transcript;

    if (transcript && transcript.trim().length > 0) {
      console.log(`User said: ${transcript}`);
      await handleUserSpeech(session, transcript);
    }
  });

  return session;
}

async function processAudioChunk(session: CallSession, media: any) {
  // Twilio sends audio as base64-encoded mulaw
  const audioBuffer = Buffer.from(media.payload, 'base64');

  // Send to Deepgram for transcription
  if (session.deepgramConnection) {
    session.deepgramConnection.send(audioBuffer);
  }
}

async function handleUserSpeech(session: CallSession, transcript: string) {
  // Add to conversation history
  session.conversationHistory.push({
    role: 'user',
    content: transcript,
  });

  // Call Claude agent (SAME AGENTS YOU BUILT IN PHASE 1!)
  const agentResponse = await complianceQAAgent.answerQuestion({
    question: transcript,
    employeeId: session.employeeId,
    conversationHistory: session.conversationHistory,
  });

  // Add agent response to history
  session.conversationHistory.push({
    role: 'assistant',
    content: agentResponse.answer,
  });

  // Convert text to speech
  await speakToUser(session, agentResponse.answer);
}

async function speakToUser(session: CallSession, text: string) {
  // Generate speech with ElevenLabs
  const audioStream = await elevenlabs.generate({
    voice: 'Rachel', // Natural, friendly voice
    text,
    model_id: 'eleven_turbo_v2', // Fast, low-latency model
  });

  // Convert audio stream to format Twilio expects (mulaw, 8kHz)
  const audioBuffer = await streamToBuffer(audioStream);
  const mulawBuffer = convertToMulaw(audioBuffer);

  // Send audio back to Twilio
  if (session.streamSid) {
    const mediaMessage = {
      event: 'media',
      streamSid: session.streamSid,
      media: {
        payload: mulawBuffer.toString('base64'),
      },
    };

    // Send via WebSocket back to Twilio
    // (You'll need to keep WS connection reference)
    sendToTwilio(session.callSid, mediaMessage);
  }
}

async function cleanupCallSession(session: CallSession) {
  // Close Deepgram connection
  if (session.deepgramConnection) {
    session.deepgramConnection.finish();
  }

  // Log conversation for analytics
  console.log(`Call ${session.callSid} ended. Turns: ${session.conversationHistory.length}`);
}

// Helper: Convert stream to buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Helper: Convert audio to mulaw format (Twilio requirement)
function convertToMulaw(buffer: Buffer): Buffer {
  // Use audio conversion library
  // npm install audio-buffer-utils
  const AudioBufferUtils = require('audio-buffer-utils');
  // Implementation depends on input format
  return buffer; // Placeholder
}

// Helper: Send audio to Twilio
function sendToTwilio(callSid: string, message: any) {
  // Maintain map of callSid → WebSocket connection
  // Send message via that WebSocket
}
```

### Week 2: Optimize for Voice Conversations

#### Voice-Specific Agent Adjustments

**File**: `src/lib/agents/voice-compliance-agent.ts`

```typescript
import { complianceQAAgent } from './compliance-qa-agent';

/**
 * Voice-optimized wrapper around Compliance Q&A Agent
 *
 * Adjusts responses for voice conversations:
 * - Shorter, more conversational answers
 * - No markdown or formatting
 * - Asks clarifying questions instead of guessing
 * - Confirms actions verbally
 */

export class VoiceComplianceAgent {
  async handleVoiceInput(input: {
    speech: string;
    employeeId?: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<{
    speechResponse: string;
    toolsUsed: string[];
    shouldTransferToHuman?: boolean;
  }> {
    // Call underlying agent
    const result = await complianceQAAgent.answerQuestion({
      question: input.speech,
      employeeId: input.employeeId,
      conversationHistory: input.conversationHistory,
    });

    // Optimize response for voice
    const voiceResponse = this.optimizeForVoice(result.answer);

    // Check if we should transfer to human
    const shouldTransfer = this.detectTransferIntent(input.speech, result.answer);

    return {
      speechResponse: voiceResponse,
      toolsUsed: result.toolsUsed,
      shouldTransferToHuman: shouldTransfer,
    };
  }

  private optimizeForVoice(text: string): string {
    // Remove markdown formatting
    let voiceText = text.replace(/\*\*/g, ''); // Remove bold
    voiceText = voiceText.replace(/\*/g, ''); // Remove italics
    voiceText = voiceText.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'); // Remove links

    // Convert numbers to spoken form
    voiceText = voiceText.replace(/\$/g, ' dollars ');
    voiceText = voiceText.replace(/(\d+)%/g, '$1 percent');

    // Break up long paragraphs with pauses
    voiceText = voiceText.replace(/\. /g, '. <break time="300ms"/> ');

    // Limit length (voice attention span)
    if (voiceText.length > 500) {
      voiceText = voiceText.substring(0, 500);
      voiceText += '... Would you like me to continue or answer a specific question?';
    }

    return voiceText;
  }

  private detectTransferIntent(userSpeech: string, agentResponse: string): boolean {
    // Detect when to transfer to human
    const transferPhrases = [
      'talk to a person',
      'speak to someone',
      'human',
      'representative',
      'too complicated',
      'not understanding',
    ];

    const lowerSpeech = userSpeech.toLowerCase();
    return transferPhrases.some((phrase) => lowerSpeech.includes(phrase));
  }
}

export const voiceComplianceAgent = new VoiceComplianceAgent();
```

#### Add Voice-Specific Features

**1. Interrupt Handling**

```typescript
// Detect when user interrupts agent
deepgramLive.on('speech_started', () => {
  // User started speaking - stop TTS playback
  stopCurrentSpeech(session);
});
```

**2. Identify Caller (Phone → Employee)**

```typescript
async function identifyEmployee(phoneNumber: string): Promise<string | null> {
  const supabase = createServiceClient();

  const { data: employee } = await supabase
    .from('employees_cache')
    .select('id, first_name, last_name')
    .eq('phone', phoneNumber)
    .single();

  if (employee) {
    return employee.id;
  }

  return null;
}

// In call initialization:
const employeeId = await identifyEmployee(msg.start.from);
if (employeeId) {
  session.employeeId = employeeId;
  await speakToUser(session, `Hi ${employee.first_name}! How can I help you today?`);
} else {
  await speakToUser(session, 'I don\'t recognize your phone number. Can you tell me your employee ID?');
}
```

**3. DTMF (Button Press) Support**

```typescript
// Handle phone keypad input
ws.on('message', async (message: string) => {
  const msg = JSON.parse(message);

  if (msg.event === 'dtmf') {
    // User pressed phone button
    const digit = msg.dtmf.digit;

    if (digit === '0') {
      // Transfer to human
      await transferToHuman(session);
    } else if (digit === '9') {
      // Repeat last message
      await repeatLastMessage(session);
    }
  }
});
```

### Week 3: Advanced Voice Features

#### Multi-Language Support

```typescript
// Detect language from speech
const languageDetection = await deepgram.transcription.detectLanguage(audioBuffer);

if (languageDetection.language === 'es') {
  // Switch to Spanish agent
  const spanishAgent = new VoiceComplianceAgent({
    language: 'es',
    voice: 'Penelope', // Spanish ElevenLabs voice
  });
}
```

#### Voice Analytics

```typescript
// Track voice conversation metrics
interface VoiceAnalytics {
  callSid: string;
  employeeId?: string;
  duration: number; // seconds
  turns: number; // conversation turns
  toolsUsed: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  resolved: boolean;
  transferredToHuman: boolean;
  cost: {
    telephony: number; // Twilio
    stt: number; // Deepgram
    tts: number; // ElevenLabs
    ai: number; // Claude
    total: number;
  };
}

async function logVoiceAnalytics(session: CallSession): Promise<void> {
  const analytics: VoiceAnalytics = {
    callSid: session.callSid,
    employeeId: session.employeeId,
    duration: calculateDuration(session),
    turns: session.conversationHistory.length / 2,
    toolsUsed: extractToolsUsed(session),
    sentiment: analyzeSentiment(session),
    resolved: checkIfResolved(session),
    transferredToHuman: session.transferredToHuman || false,
    cost: calculateCost(session),
  };

  // Store in database
  const supabase = createServiceClient();
  await supabase.from('voice_call_analytics').insert(analytics);
}
```

#### Call Recording & Compliance

```typescript
// Enable call recording (for quality/compliance)
response.say('This call may be recorded for quality and training purposes.');
response.record({
  recordingStatusCallback: '/api/voice/recording-complete',
  maxLength: 600, // 10 minutes max
  transcribe: true,
});
```

---

## Cost Breakdown

### Per-Minute Costs

| Service | Cost | Notes |
|---------|------|-------|
| **Twilio Voice** | $0.0085/min | Inbound calls (US) |
| **Deepgram STT** | $0.0043/min | Nova-2 model (real-time) |
| **ElevenLabs TTS** | $0.018/min | Turbo v2 model |
| **Claude API** | $0.005/min | ~5 turns/minute average |
| **Total** | **$0.036/min** | ~$2.16 per hour |

### Monthly Estimate (1000 employees)

**Scenario**: 200 calls/month, avg 5 minutes each

```
200 calls × 5 minutes × $0.036/min = $36/month
```

**ROI**: Each resolved compliance issue via voice = $100-500 saved vs in-person assistance.

---

## Alternative: Twilio Voice + Google Dialogflow CX

### Pros
- Fully managed voice agent platform
- Built-in conversation management
- Natural language understanding

### Cons
- Less flexibility than custom solution
- Harder to integrate with Claude agents
- Higher cost (~$0.06/min)
- Vendor lock-in

---

## Alternative: Anthropic's Native Voice (Future)

Anthropic may release native voice capabilities for Claude. If/when available:

```typescript
// Hypothetical future API
const voiceAgent = new Anthropic.VoiceAgent({
  model: 'claude-sonnet-4.5',
  voice: 'natural',
  systemPrompt: '...',
  tools: [...],
});

// Direct audio in/out
const audioResponse = await voiceAgent.speak({
  audioInput: userAudioBuffer,
  conversationHistory: [...],
});
```

**Wait for this?** No - implement Twilio + Deepgram + ElevenLabs now. Easy to swap later.

---

## Implementation Checklist

### Phase 1: Basic Voice (Week 1)
- [ ] Set up Twilio phone number
- [ ] Install Deepgram SDK
- [ ] Install ElevenLabs SDK
- [ ] Create `/api/voice/incoming` endpoint
- [ ] Build WebSocket stream handler
- [ ] Test basic call → speech → agent → response flow

### Phase 2: Agent Integration (Week 2)
- [ ] Connect voice to existing Q&A agent
- [ ] Add caller identification
- [ ] Optimize responses for voice
- [ ] Add interrupt handling
- [ ] Test multi-turn conversations

### Phase 3: Production Ready (Week 3)
- [ ] Add call recording
- [ ] Implement transfer to human
- [ ] Add analytics tracking
- [ ] Monitor costs
- [ ] Load testing (concurrent calls)
- [ ] Deploy to production

---

## Example: Complete Voice Flow

### Employee Experience

```
Employee dials: 1-555-COMPLY

Agent: "Hello! Welcome to ReguGuard Compliance Assistant. How can I help you today?"

Employee: "When does my license expire?"

Agent: [Deepgram transcribes → Claude agent queries DB → ElevenLabs speaks]
"Hi John! Your Texas Armed Guard License expires in 18 days, on February 20th.
Would you like me to help you start the renewal process?"

Employee: "Yes, how much will that cost?"

Agent: [Agent autonomously: checks state requirements, calculates cost]
"Your renewal will cost $65 total. That's $25 for the renewal fee and $40 for
the required 6-hour training course. I found three approved online training
providers. Want me to send you the details via text?"

Employee: "Sure, and can you send me a checklist?"

Agent: [Agent uses tools: send_sms, create_renewal_checklist]
"Done! I've sent you a text with the training providers and a complete renewal
checklist. You have 18 days, so you're in good shape. Anything else I can help
with?"

Employee: "No, that's it. Thanks!"

Agent: "You're welcome! Call anytime if you have questions. Goodbye!"

[Call ends - Analytics logged - Cost: $0.18 for 5-minute call]
```

---

## SMS + Voice Unified Experience

**Best Practice**: Offer both channels, same agents

```typescript
// Unified agent interface
interface ConversationChannel {
  type: 'sms' | 'voice' | 'web';
  send(message: string): Promise<void>;
  receive(): AsyncIterator<string>;
}

// Same agent, different channels
async function handleConversation(
  channel: ConversationChannel,
  employeeId: string
) {
  for await (const userMessage of channel.receive()) {
    const response = await complianceQAAgent.answerQuestion({
      question: userMessage,
      employeeId,
    });

    await channel.send(response.answer);
  }
}
```

**Employee can switch mid-conversation**:
- Start on phone
- Agent texts checklist
- Employee replies via SMS for follow-up
- Same conversation thread!

---

## Next Steps

1. **After Phase 1 (Claude SDK agents)**: Start voice integration
2. **Week 1**: Get Twilio phone number, test basic call flow
3. **Week 2**: Connect to Q&A agent
4. **Week 3**: Production deployment
5. **Iterate**: Monitor usage, optimize based on employee feedback

**Want me to start implementing the voice integration after we complete Phase 1?**
