const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-al-test',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

test("broker can't read another broker's client", async () => {
  const broker2 = testEnv.authenticatedContext('broker2', { role: 'broker' });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().collection('applications').doc('app1').set({
      borrowerId: 'borrower1',
      brokerId: 'broker1',
      status: 'Applied',
    });
  });

  await assertFails(
    broker2.firestore().collection('applications').doc('app1').get()
  );
});