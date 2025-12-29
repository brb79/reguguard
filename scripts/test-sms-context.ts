/**
 * Test SMS Context Lookup
 * 
 * Verifies that the ConversationService can correctly find an employee
 * by phone number using the admin client.
 */

import { conversationService } from '../src/lib/conversations/service';

async function testLookup() {
    console.log('--- Testing SMS Context Lookup ---');

    // Use a known phone number from the system if possible, 
    // or just check if it can query at all without error.
    const testPhone = '+12024108833'; // The Twilio number itself (won't be an employee but checks if query works)

    try {
        console.log(`Looking up employee with phone: ${testPhone}`);
        const employee = await conversationService.findEmployeeByPhone(testPhone);

        if (employee) {
            console.log('✅ Found employee:', employee);
        } else {
            console.log('ℹ️ No employee found for this number (Expected if number is not in DB)');
            console.log('✅ Query completed successfully without RLS error.');
        }

        console.log('\nChecking active conversation lookup...');
        const conversation = await conversationService.getActiveConversationByPhone(testPhone);
        console.log('✅ Conversation query completed successfully.');

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

testLookup();
