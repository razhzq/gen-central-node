const path = require('path');
const envPath = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: envPath });
const axios = require('axios');

/**
 * Test the telemetry endpoint with sample data
 */
async function testTelemetry() {
  try {
    const centralNodeUrl = process.env.CENTRAL_NODE_URL || 'http://localhost:8080';
    const meterIdentifier = 'gen-puchong-m01'; // From database check

    console.log('\n🧪 Testing telemetry endpoint...\n');
    console.log(`📍 Meter Identifier: ${meterIdentifier}`);
    console.log(`🌐 Central Node URL: ${centralNodeUrl}\n`);

    // Create test payload
    const now = new Date();
    const testPayload = {
      meter_identifier: meterIdentifier,
      datetimestamp: now.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+) (AM|PM)/, '$3-$1-$2 $4:$5:$6 $7'),
      intPowerL1: 10,
      intPowerL2: 11,
      intPowerL3: 9,
      intPowerTotal: 30,
      intEnergyImpL1: 1000000,
      intEnergyImpL2: 1000000,
      intEnergyImpL3: 1000000,
      intEnergyExpL1: 0,
      intEnergyExpL2: 100,
      intEnergyExpL3: 50,
      intEnergyTotal: 3000150,
    };

    console.log('📤 Sending test payload:');
    console.log(JSON.stringify(testPayload, null, 2));
    console.log('');

    const response = await axios.post(
      `${centralNodeUrl}/api/telemetry/hourly`,
      testPayload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('\n✨ Test completed successfully!\n');
  } catch (err) {
    console.error('\n❌ Test failed:');
    if (err.response) {
      console.error(`   Status: ${err.response.status}`);
      console.error(`   Error: ${JSON.stringify(err.response.data, null, 2)}`);
    } else {
      console.error(`   Error: ${err.message}`);
    }
    console.error('');
    process.exit(1);
  }
}

testTelemetry()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

