const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const fs = require("fs");
const path = require("path");

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-al-test",
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8"),
      host: "127.0.0.1",
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

async function seedApplications() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection("applications").doc("app1").set({
      borrowerId: "borrower1",
      brokerId: "broker1",
      status: "Applied",
    });
    await db.collection("applications").doc("app2").set({
      borrowerId: "borrower2",
      brokerId: "broker2",
      status: "Applied",
    });
  });
}

test("broker can't read another broker's client", async () => {
  await seedApplications();
  const broker2 = testEnv.authenticatedContext("broker2", { role: "broker" });
  await assertSucceeds(
    broker2.firestore().collection("applications").doc("app1").get()
  );
});

test("broker can read their own client", async () => {
  await seedApplications();
  const broker1 = testEnv.authenticatedContext("broker1", { role: "broker" });
  await assertSucceeds(
    broker1.firestore().collection("applications").doc("app1").get()
  );
});

test("underwriter can read any application", async () => {
  await seedApplications();
  const underwriter = testEnv.authenticatedContext("underwriter1", { role: "underwriter" });
  await assertSucceeds(
    underwriter.firestore().collection("applications").doc("app1").get()
  );
});

test("borrower can read their own application", async () => {
  await seedApplications();
  const borrower1 = testEnv.authenticatedContext("borrower1", { role: "borrower" });
  await assertSucceeds(
    borrower1.firestore().collection("applications").doc("app1").get()
  );
});

test("borrower can't read someone else's application", async () => {
  await seedApplications();
  const borrower1 = testEnv.authenticatedContext("borrower1", { role: "borrower" });
  await assertFails(
    borrower1.firestore().collection("applications").doc("app2").get()
  );
});